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
  const { data: rows } = await db
    .from("suppliers")
    .select("id, name, contact_name, email, phone, is_active, created_at")
    .order("name", { ascending: true });

  const suppliers = (rows || []).map((s: any) => ({
    id: s.id,
    name: s.name,
    company_name: s.name,
    contact_person: s.contact_name || "",
    email: s.email || "",
    phone: s.phone || "",
    performance_score: 5.0,
    status: s.is_active === false ? "INACTIVE" : "ACTIVE",
    created_at: s.created_at,
  }));

  return <SuppliersClient suppliers={suppliers} />;
}
