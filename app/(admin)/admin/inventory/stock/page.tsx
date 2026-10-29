import { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { StockControlClient } from "@/features/inventory/components/StockControlClient";

export const metadata: Metadata = {
  title: "Stock Control | Anchor Fashion",
  description: "Monitor and adjust real-time inventory levels across warehouses.",
};

export const dynamic = "force-dynamic";

/**
 * Shape a Prisma variant (+ its product) into exactly the plain object the
 * stock client reads: `variants.sku`, `variants.product.name`, …
 * Decimals are serialized to plain numbers so the row can cross the
 * server → client boundary.
 */
function mapVariant(variant: any) {
  if (!variant) return null;
  const product = variant.product ?? null;
  return {
    id: variant.id,
    sku: variant.sku,
    barcode: variant.barcode ?? null,
    attributes: variant.attributes ?? {},
    price_override:
      variant.priceOverride !== null && variant.priceOverride !== undefined
        ? Number(variant.priceOverride)
        : null,
    sale_price:
      variant.salePrice !== null && variant.salePrice !== undefined
        ? Number(variant.salePrice)
        : null,
    product: product
      ? {
          id: product.id,
          name: product.name,
          sku: product.sku ?? null,
          base_price: Number(product.basePrice ?? 0),
          cost_price:
            product.costPrice !== null && product.costPrice !== undefined
              ? Number(product.costPrice)
              : null,
        }
      : null,
  };
}

export default async function StockControlPage() {
  // Prisma is the reliable path here: the fluent builder's select-embed
  // syntax (`variants(..., product:products(...)), warehouses(...)`) is not
  // resolved for inventory_levels, so rows used to arrive flat — no
  // `variants` / `warehouses` objects — and the client rendered
  // "N/A" / "Standard Product" for every row.
  const [levels, warehouses, variants, suppliers] = await Promise.all([
    prisma.inventoryLevel.findMany({
      orderBy: { quantityAvailable: "asc" },
    }),
    prisma.warehouse.findMany({
      orderBy: { name: "asc" },
    }),
    prisma.variant.findMany({
      orderBy: { sku: "asc" },
      include: {
        product: {
          select: { id: true, name: true, sku: true, basePrice: true, costPrice: true },
        },
      },
    }),
    // Real table is `suppliers` (the previous query targeted the phantom
    // `supplier_profiles` table and always returned []).
    prisma.supplier.findMany({
      orderBy: { name: "asc" },
    }),
  ]);

  const variantById = new Map(variants.map((v) => [v.id, v]));
  const warehouseById = new Map(warehouses.map((w) => [w.id, w]));

  const inventory = levels.map((level) => {
    const warehouse = warehouseById.get(level.warehouseId) ?? null;
    return {
      id: level.id,
      variant_id: level.variantId,
      warehouse_id: level.warehouseId,
      quantity_available: level.quantityAvailable,
      quantity_reserved: level.quantityReserved,
      // inventory_levels has no damaged / returned / incoming columns in
      // Prisma (the builder's write sanitizer strips them); the client
      // renders these fields, so default them to 0 rather than undefined.
      quantity_damaged: 0,
      quantity_returned: 0,
      quantity_incoming: 0,
      reorder_point: level.reorderPoint,
      created_at: level.createdAt.toISOString(),
      updated_at: level.updatedAt.toISOString(),
      variants: mapVariant(variantById.get(level.variantId) ?? null),
      warehouses: warehouse
        ? { id: warehouse.id, name: warehouse.name, is_active: warehouse.isActive }
        : null,
    };
  });

  const allWarehouses = warehouses.map((w) => ({
    id: w.id,
    name: w.name,
    is_active: w.isActive,
  }));

  const allVariants = variants.map((v) => mapVariant(v));

  const allSuppliers = suppliers.map((s) => ({
    id: s.id,
    company_name: s.name,
    contact_person: s.contactName ?? null,
    email: s.email ?? null,
    phone: s.phone ?? null,
  }));

  return (
    <StockControlClient
      inventory={inventory}
      allWarehouses={allWarehouses}
      allVariants={allVariants}
      allSuppliers={allSuppliers}
    />
  );
}
