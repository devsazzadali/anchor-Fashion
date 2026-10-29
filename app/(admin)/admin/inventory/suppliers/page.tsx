import { Metadata } from "next";
import { createAdminDbClient } from "@/lib/db/client";
import { SuppliersClient } from "@/features/inventory/components/SuppliersClient";

export const metadata: Metadata = {
  title: "Suppliers | Anchor Fashion",
  description: "Manage supplier profiles, contact information, and performance ratings.",
};

export const dynamic = "force-dynamic";

export default async function SuppliersPage() {
  const db = createAdminDbClient();
  const { data: suppliers } = await db
    .from("supplier_profiles")
    .select("*")
    .order("company_name", { ascending: true });

  return <SuppliersClient suppliers={suppliers || []} />;
}
