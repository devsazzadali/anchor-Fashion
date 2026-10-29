import { Metadata } from "next";
import { createAdminDbClient } from "@/lib/db/client";
import { StockControlClient } from "@/features/inventory/components/StockControlClient";

export const metadata: Metadata = {
  title: "Stock Control | Anchor Fashion",
  description: "Monitor and adjust real-time inventory levels across warehouses.",
};

export default async function StockControlPage() {
  const db = createAdminDbClient();

  const [
    invRes,
    whRes,
    varRes,
    supRes,
  ] = await Promise.all([
    db
      .from("inventory_levels")
      .select("*, variants(id, sku, barcode, attributes, price_override, sale_price, product:products(id, name, sku, base_price, cost_price)), warehouses(id, name, is_active)")
      .order("quantity_available", { ascending: true }),
    db
      .from("warehouses")
      .select("id, name, is_active")
      .order("name", { ascending: true }),
    db
      .from("variants")
      .select("id, sku, barcode, price_override, sale_price, attributes, product:products(id, name, sku, base_price, cost_price)")
      .order("sku", { ascending: true }),
    db
      .from("supplier_profiles")
      .select("id, company_name, contact_person, email, phone")
      .order("company_name", { ascending: true }),
  ]);

  const inventory = invRes.data || [];
  const allWarehouses = whRes.data || [];
  const allVariants = varRes.data || [];
  const allSuppliers = supRes.data || [];

  return (
    <StockControlClient
      inventory={inventory}
      allWarehouses={allWarehouses}
      allVariants={allVariants}
      allSuppliers={allSuppliers}
    />
  );
}
