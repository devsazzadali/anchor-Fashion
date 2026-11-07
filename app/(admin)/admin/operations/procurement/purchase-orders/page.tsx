import { Metadata } from "next";
import { createDbClient } from "@/lib/db/client";
import { PurchaseOrdersClient } from "@/features/inventory/components/PurchaseOrdersClient";

export const metadata: Metadata = {
  title: "Purchase Orders | Anchor Fashion Enterprise",
  description: "Manage Procurement and Purchase Orders",
};

export default async function PurchaseOrdersPage() {
  const db = await createDbClient();
  const { data: pos } = await db
    .from("procurement_orders")
    .select("*, supplier_profiles(company_name), warehouses(name)")
    .order("created_at", { ascending: false });

  return <PurchaseOrdersClient pos={pos || []} />;
}
