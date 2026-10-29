import { createAdminDbClient } from "@/lib/db/client";
import { prisma } from "@/lib/prisma";
import {
  CustomReportConfig,
  ReportQueryResult,
} from "@/types/report.types";
import {
  CustomReportConfigInput,
  ReportQueryRequestInput,
} from "@/schemas/report.schema";

export class ReportRepository {
  private getAdminClient() {
    return createAdminDbClient();
  }

  /**
   * Fetch all saved custom report configurations.
   */
  async getSavedReports(userId?: string): Promise<CustomReportConfig[]> {
    const db = this.getAdminClient();

    try {
      let query = db
        .from("custom_reports_config")
        .select("*")
        .order("updated_at", { ascending: false });

      if (userId) {
        query = query.or(`owner_id.eq.${userId},is_public.eq.true`);
      }

      const { data, error } = await query;

      if (error) {
        console.error("[ReportRepository.getSavedReports] Query error:", error);
        return [];
      }

      return (data || []).map(this.mapRowToConfig);
    } catch (err: any) {
      console.error("[ReportRepository.getSavedReports] Exception:", err);
      return [];
    }
  }

  /**
   * Fetch a single saved report configuration by ID.
   */
  async getReportById(id: string): Promise<CustomReportConfig | null> {
    const db = this.getAdminClient();

    const { data, error } = await db
      .from("custom_reports_config")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw new Error(`Failed to fetch report: ${error.message}`);
    }

    return this.mapRowToConfig(data);
  }

  /**
   * Save (insert or update) a custom report configuration in the database.
   */
  async saveReport(
    config: CustomReportConfigInput,
    userId?: string
  ): Promise<CustomReportConfig> {
    const db = this.getAdminClient();

    // Fallback user ID if anonymous or system execution
    let ownerId = userId;
    if (!ownerId) {
      const { data: firstProfile } = await db
        .from("profiles")
        .select("id")
        .limit(1)
        .single();
      ownerId = firstProfile?.id || "00000000-0000-0000-0000-000000000000";
    }

    const payload: Record<string, any> = {
      report_name: config.report_name.trim(),
      description: config.description?.trim() || null,
      dimensions: config.dimensions,
      metrics: config.metrics,
      filters: config.filters || {},
      chart_type: config.chart_type || "table",
      is_public: config.is_public ?? false,
      updated_at: new Date().toISOString(),
    };

    if (config.id) {
      // Update existing
      const { data, error } = await db
        .from("custom_reports_config")
        .update(payload)
        .eq("id", config.id)
        .select()
        .single();

      if (error) throw new Error(`Failed to update report: ${error.message}`);
      return this.mapRowToConfig(data);
    } else {
      // Insert new
      payload.owner_id = ownerId;
      const { data, error } = await db
        .from("custom_reports_config")
        .insert(payload)
        .select()
        .single();

      if (error) throw new Error(`Failed to save report: ${error.message}`);
      return this.mapRowToConfig(data);
    }
  }

  /**
   * Delete a saved report by ID.
   */
  async deleteReport(id: string): Promise<void> {
    const db = this.getAdminClient();
    const { error } = await db
      .from("custom_reports_config")
      .delete()
      .eq("id", id);

    if (error) throw new Error(`Failed to delete report: ${error.message}`);
  }

  /**
   * Safe Server-Side Query Execution
   * Executes parameterized queries against enterprise analytical tables (bi_sales_mart, categories, brands).
   * Strictly prevents raw SQL execution.
   */
  async executeReportQuery(
    params: ReportQueryRequestInput
  ): Promise<ReportQueryResult> {
    const db = this.getAdminClient();

    const { dimensions, metrics, dateRange, startDate, endDate, limit = 100 } = params;

    // 1. Calculate Date Range Bounds
    const now = new Date();
    let fromDate = new Date();
    let toDate = new Date();

    switch (dateRange) {
      case "7d":
        fromDate.setDate(now.getDate() - 7);
        break;
      case "30d":
        fromDate.setDate(now.getDate() - 30);
        break;
      case "90d":
        fromDate.setDate(now.getDate() - 90);
        break;
      case "ytd":
        fromDate = new Date(now.getFullYear(), 0, 1);
        break;
      case "custom":
        if (startDate) fromDate = new Date(startDate);
        if (endDate) toDate = new Date(endDate);
        break;
      default:
        fromDate.setDate(now.getDate() - 7);
    }

    // 2. Fetch authoritative analytics data from Neon PostgreSQL orders.
    // Every row is built from a real order line: sales = line total,
    // profit = (unit_price - product cost_price) x quantity (the Phase-4
    // cost-based rule). Orders do not record a device, so the device
    // dimension is reported as "-" rather than invented. When there are no
    // orders in range the report is honestly empty - this method previously
    // generated pseudo-random "realistic" sales rows and a flat 35% margin;
    // both fabrications were removed in Phase 6.
    let rawData: any[] = [];
    try {
      const realOrders = await prisma.order.findMany({
        where: {
          createdAt: {
            gte: fromDate,
            lte: toDate,
          },
        },
        include: {
          items: {
            include: {
              product: {
                select: {
                  costPrice: true,
                  category: { select: { name: true } },
                  brand: { select: { name: true } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
      });

      const NON_REVENUE = ["CANCELLED", "FAILED", "REFUNDED", "RETURNED"];
      for (const o of realOrders) {
        const date = o.createdAt.toISOString().split("T")[0];
        const region = (o.shippingAddress as any)?.city || "-";
        const orderTotal = Number(o.totalAmount || 0);
        const status = String(o.status || "").toUpperCase();

        if (NON_REVENUE.includes(status)) {
          // Cancelled/failed/refunded orders contribute a refund only -
          // never sales, units or profit.
          rawData.push({
            date,
            category: "-",
            brand: "-",
            region,
            device: "-",
            sales: 0,
            orders: 0,
            units: 0,
            refunds: orderTotal,
            profit: 0,
          });
          continue;
        }

        const items = o.items || [];
        if (items.length === 0) {
          rawData.push({
            date,
            category: "-",
            brand: "-",
            region,
            device: "-",
            sales: orderTotal,
            orders: 1,
            units: 0,
            refunds: 0,
            profit: 0,
          });
          continue;
        }

        items.forEach((it: any, idx: number) => {
          const qty = it.quantity || 1;
          const unitPrice = Number(it.unitPrice || 0);
          const cost = Number(it.product?.costPrice || 0);
          rawData.push({
            date,
            category: it.product?.category?.name || "-",
            brand: it.product?.brand?.name || "-",
            region,
            device: "-",
            sales: Number(it.totalPrice || unitPrice * qty),
            // Count the order once, on its first line, so the orders
            // metric stays a true order count under any grouping.
            orders: idx === 0 ? 1 : 0,
            units: qty,
            refunds: 0,
            profit: Math.round((unitPrice - cost) * qty * 100) / 100,
          });
        });
      }
    } catch (orderErr) {
      console.warn("[ReportRepository] Error querying real orders:", orderErr);
    }

    // 3. Dynamic Aggregation by selected Dimensions
    const groupedMap = new Map<string, Record<string, any>>();
    const summary: Record<string, number> = {};
    metrics.forEach((m) => (summary[m] = 0));

    for (const item of rawData) {
      // Form compound grouping key from selected dimensions
      const keyParts = dimensions.map((d) => String(item[d] ?? "-"));
      const groupKey = keyParts.join("___");

      if (!groupedMap.has(groupKey)) {
        const initRow: Record<string, any> = {};
        dimensions.forEach((d) => {
          initRow[d] = item[d] ?? "-";
        });
        metrics.forEach((m) => {
          initRow[m] = 0;
        });
        groupedMap.set(groupKey, initRow);
      }

      const existingRow = groupedMap.get(groupKey)!;
      metrics.forEach((m) => {
        const val = Number(item[m]) || 0;
        existingRow[m] = Math.round((existingRow[m] + val) * 100) / 100;
        summary[m] = Math.round((summary[m] + val) * 100) / 100;
      });
    }

    const aggregatedRows = Array.from(groupedMap.values()).slice(0, limit);

    return {
      columns: [...dimensions, ...metrics],
      data: aggregatedRows,
      totalRows: aggregatedRows.length,
      summary,
      generatedAt: new Date().toISOString(),
    };
  }

  private mapRowToConfig(row: any): CustomReportConfig {
    return {
      id: row.id,
      owner_id: row.owner_id,
      report_name: row.report_name,
      description: row.description,
      dimensions: Array.isArray(row.dimensions) ? row.dimensions : [],
      metrics: Array.isArray(row.metrics) ? row.metrics : [],
      filters: typeof row.filters === "object" ? row.filters : {},
      chart_type: row.chart_type || "table",
      is_public: !!row.is_public,
      schedule_cron: row.schedule_cron,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
