import { Metadata } from "next";
import { createAdminDbClient } from "@/lib/db/client";
import { AuditsClient } from "@/features/inventory/components/AuditsClient";
import { getWarehouses } from "@/app/actions/admin/procurement.actions";

export const metadata: Metadata = {
  title: "Inventory Audits | Anchor Fashion",
  description: "Manage cycle counts, blind verifications, and physical inventory reconciliation.",
};

export const dynamic = "force-dynamic";

export default async function AuditsPage() {
  const db = createAdminDbClient();

  const [{ data: audits }, whRes] = await Promise.all([
    db
      .from("inventory_audits")
      .select("*")
      .order("created_at", { ascending: false }),
    getWarehouses(),
  ]);

  // The DB layer does not attach embedded relations, so join the
  // warehouse name onto each audit manually (the client reads
  // `audit.warehouses?.name`).
  const warehouseById = new Map<string, any>(
    (whRes.success && whRes.data ? whRes.data : []).map((w: any) => [w.id, w] as [string, any])
  );
  const auditsWithWarehouse = (audits || []).map((a: any) => {
    const w = warehouseById.get(a.warehouse_id);
    return {
      ...a,
      warehouses: w ? { id: w.id, name: w.name } : null,
      warehouse: w ? { id: w.id, name: w.name } : null,
    };
  });

  return (
    <AuditsClient
      audits={auditsWithWarehouse}
      allWarehouses={whRes.success && whRes.data ? whRes.data : []}
    />
  );
}
