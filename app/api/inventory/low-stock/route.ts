import { NextRequest, NextResponse } from "next/server";
import { createAdminDbClient } from "@/lib/db/client";
import { verifyStaff } from "@/lib/security/roles";
import { authErrorResponse } from "@/lib/api/auth-error";

/**
 * REG-65 Batch 9: one inventory_levels builder row joined to its variant
 * and warehouse — exactly the fields the low-stock mapping reads.
 */
interface LowStockRow {
  id: string;
  variant_id: string;
  quantity_available?: number | null;
  quantity_reserved?: number | null;
  reorder_point?: number | null;
  safety_stock?: number | null;
  variant?: {
    sku?: string | null;
    product?: { name?: string | null } | null;
  } | null;
  warehouse?: { name?: string | null; warehouse_code?: string | null } | null;
}

export async function GET(request: NextRequest) {
  try {
    await verifyStaff();
    const { searchParams } = new URL(request.url);
    const warehouseId = searchParams.get("warehouse_id") || undefined;
    const db = createAdminDbClient();

    let query = db
      .from("inventory_levels")
      .select(
        `*,
        variant:variants(
          id,
          sku,
          barcode,
          product:products(id, name, base_price)
        ),
        warehouse:warehouses(id, name, warehouse_code)`
      );

    if (warehouseId) {
      query = query.eq("warehouse_id", warehouseId);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const lowStockItems = (data || [])
      .filter((row: LowStockRow) => {
        const avail = Number(row.quantity_available) || 0;
        const threshold = Number(row.reorder_point) || Number(row.safety_stock) || 5;
        return avail <= threshold;
      })
      .map((row: LowStockRow) => ({
        id: row.id,
        variant_id: row.variant_id,
        sku: row.variant?.sku || "—",
        product_name: row.variant?.product?.name || "Product",
        warehouse_name: row.warehouse?.name || "Warehouse",
        warehouse_code: row.warehouse?.warehouse_code || "",
        quantity_available: row.quantity_available,
        quantity_reserved: row.quantity_reserved,
        reorder_point: row.reorder_point,
        safety_stock: row.safety_stock,
        is_out_of_stock: (row.quantity_available || 0) <= 0,
      }));

    return NextResponse.json({
      total: lowStockItems.length,
      items: lowStockItems,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
