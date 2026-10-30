import { Metadata } from "next";
import { createAdminDbClient } from "@/lib/db/client";
import { StockTransfersClient } from "@/features/inventory/components/StockTransfersClient";
import { getWarehouses, getVariants } from "@/app/actions/admin/procurement.actions";

export const metadata: Metadata = {
  title: "Stock Transfers | Anchor Fashion",
  description: "Manage internal inventory movements and transfers between warehouses.",
};

export const dynamic = "force-dynamic";

export default async function TransfersPage() {
  const db = createAdminDbClient();

  // S4-8: transfers are recorded as stock_movements rows with
  // movement_type TRANSFER_IN / TRANSFER_OUT. The previous query filtered
  // on `reason` / `reason_code` — columns that do not exist on
  // stock_movements — which silently poisoned the whole query, so the
  // list was always empty even though the transfers themselves executed.
  const [transfersRes, whRes, varRes] = await Promise.all([
    db
      .from("stock_movements")
      .select("*")
      .in("movement_type", ["TRANSFER_IN", "TRANSFER_OUT"])
      .order("created_at", { ascending: false })
      .limit(100),
    getWarehouses(),
    getVariants(),
  ]);

  const rows = transfersRes.data || [];

  // The DB layer does not attach embedded relations, so resolve variant
  // and warehouse names manually for the list.
  const variantIds = [...new Set(rows.map((t: any) => t.variant_id).filter(Boolean))];
  const warehouseIds = [...new Set(rows.map((t: any) => t.warehouse_id).filter(Boolean))];

  const [variantRowsRes, warehouseRowsRes] = await Promise.all([
    variantIds.length
      ? db.from("variants").select("id, sku, attributes, product_id").in("id", variantIds)
      : Promise.resolve({ data: [] as any[] }),
    warehouseIds.length
      ? db.from("warehouses").select("id, name, code").in("id", warehouseIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const variantRows = (variantRowsRes as any).data || [];
  const productIds = [...new Set(variantRows.map((v: any) => v.product_id).filter(Boolean))];
  const productRows = productIds.length
    ? ((await db.from("products").select("id, name").in("id", productIds)) as any).data || []
    : [];

  const variantById = new Map<string, any>(variantRows.map((v: any) => [v.id, v] as [string, any]));
  const productById = new Map<string, any>(productRows.map((p: any) => [p.id, p] as [string, any]));
  const warehouseById = new Map<string, any>((((warehouseRowsRes as any).data || []) as any[]).map((w: any) => [w.id, w] as [string, any]));

  const mappedTransfers = rows.map((t: any) => {
    const variant = variantById.get(t.variant_id);
    const product = variant ? productById.get(variant.product_id) : undefined;
    const warehouse = warehouseById.get(t.warehouse_id);
    const pName = product?.name || "Product";
    const sku = variant?.sku || "";
    const attr = variant?.attributes
      ? Object.values(variant.attributes).filter(Boolean).join(" / ")
      : "";
    const friendlyName = attr
      ? `${pName} (${sku} - ${attr})`
      : sku
        ? `${pName} (${sku})`
        : pName;

    return {
      ...t,
      quantity: t.quantity ?? 0,
      reason_code: "TRANSFER",
      variants: {
        id: t.variant_id,
        sku,
        name: friendlyName,
        attributes: variant?.attributes || null,
      },
      warehouses: warehouse ? { id: warehouse.id, name: warehouse.name, code: warehouse.code } : null,
    };
  });

  return (
    <StockTransfersClient
      transfers={mappedTransfers}
      allWarehouses={whRes.success && whRes.data ? whRes.data : []}
      allVariants={varRes.success && varRes.data ? varRes.data : []}
    />
  );
}
