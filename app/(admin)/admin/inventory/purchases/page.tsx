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
  const { data: pos } = await db
    .from("procurement_orders")
    .select("*, supplier_profiles(company_name), warehouses(name)")
    .order("created_at", { ascending: false });

  return <PurchaseOrdersClient pos={pos || []} />;
}
