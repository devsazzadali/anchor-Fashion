import { Metadata } from "next";
import { createAdminDbClient } from "@/lib/db/client";
import { PurchaseOrdersClient } from "@/features/inventory/components/PurchaseOrdersClient";

export const metadata: Metadata = {
  title: "Purchase Orders | Anchor Fashion",
  description: "Manage procurement, supplier orders, and warehouse goods receiving.",
};

export const dynamic = "force-dynamic";

export default async function PurchasesPage() {
  const db = createAdminDbClient();
  // S4-6: the real table is `purchase_orders` (this page previously read
  // a nonexistent `procurement_orders` / `supplier_profiles` pair, which
  // the DB layer answered with an empty success — the list was always
  // empty). Supplier/warehouse names are joined manually because the DB
  // layer does not attach embedded relations, and mapped into the shape
  // PurchaseOrdersClient renders.
  const { data: pos } = await db
    .from("purchase_orders")
    .select("*")
    .order("created_at", { ascending: false });

  const rows = pos || [];
  const supplierIds = [...new Set(rows.map((p: any) => p.supplier_id).filter(Boolean))];
  const warehouseIds = [...new Set(rows.map((p: any) => p.warehouse_id).filter(Boolean))];

  const [suppliersRes, warehousesRes] = await Promise.all([
    supplierIds.length
      ? db.from("suppliers").select("id, name").in("id", supplierIds)
      : Promise.resolve({ data: [] as any[] }),
    warehouseIds.length
      ? db.from("warehouses").select("id, name").in("id", warehouseIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const supplierById = new Map<string, any>((((suppliersRes as any).data || []) as any[]).map((s: any) => [s.id, s] as [string, any]));
  const warehouseById = new Map<string, any>((((warehousesRes as any).data || []) as any[]).map((w: any) => [w.id, w] as [string, any]));

  const mapped = rows.map((po: any) => {
    const supplier = supplierById.get(po.supplier_id);
    const warehouse = warehouseById.get(po.warehouse_id);
    return {
      ...po,
      expected_delivery_date: po.expected_date || null,
      supplier_profiles: supplier ? { company_name: supplier.name } : null,
      warehouses: warehouse ? { name: warehouse.name } : null,
    };
  });

  return <PurchaseOrdersClient pos={mapped} />;
}
