/**
 * Sales report CSV builder (S6-8).
 *
 * Pure and synchronous over the ALREADY-AGGREGATED report data — the
 * row set is the report's own (recentOrders is capped at 8 and
 * topSellingProducts at 5 by AnalyticsRepository.getSalesAnalytics),
 * so generation is bounded and instant. The old Export handler called
 * window.print() on the chart-heavy analytics page, which froze the
 * tab and produced no file at all.
 */

export interface SalesReportOrderRow {
  orderNumber: string;
  customerName: string;
  amount: number;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  createdAt: string;
}

export interface SalesReportProductRow {
  name: string;
  quantity: number;
  revenue: number;
}

export interface SalesReportData {
  totalSales: number;
  totalOrders: number;
  averageOrderValue: number;
  cancelledOrdersCount: number;
  recentOrders: SalesReportOrderRow[];
  topSellingProducts: SalesReportProductRow[];
}

function csvCell(value: unknown): string {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildSalesReportCsv(
  sales: SalesReportData,
  range: { from: string; to: string }
): string {
  const lines: string[] = [];

  lines.push("Anchor Fashion - Sales Report");
  lines.push(`Period,${csvCell(range.from)} to ${csvCell(range.to)}`);
  lines.push("");
  lines.push("Summary");
  lines.push(`Total Sales (BDT),${Number(sales.totalSales || 0).toFixed(2)}`);
  lines.push(`Valid Orders,${sales.totalOrders || 0}`);
  lines.push(
    `Average Order Value (BDT),${Number(sales.averageOrderValue || 0).toFixed(2)}`
  );
  lines.push(`Cancelled Orders,${sales.cancelledOrdersCount || 0}`);
  lines.push("");
  lines.push("Recent Orders");
  lines.push(
    "Order Number,Customer,Date,Amount (BDT),Status,Payment Method,Payment Status"
  );
  for (const o of sales.recentOrders || []) {
    lines.push(
      [
        o.orderNumber,
        o.customerName,
        o.createdAt ? new Date(o.createdAt).toISOString().slice(0, 10) : "",
        Number(o.amount || 0).toFixed(2),
        o.status,
        o.paymentMethod,
        o.paymentStatus,
      ]
        .map(csvCell)
        .join(",")
    );
  }
  lines.push("");
  lines.push("Top Products");
  lines.push("Product,Quantity Sold,Revenue (BDT)");
  for (const p of sales.topSellingProducts || []) {
    lines.push(
      [p.name, p.quantity, Number(p.revenue || 0).toFixed(2)]
        .map(csvCell)
        .join(",")
    );
  }

  return lines.join("\n");
}
