"use server";

import { createAdminDbClient } from "@/lib/db/client";
import { prisma } from "@/lib/prisma";
import { escapeLikeWildcards } from "@/lib/utils/like-escape";
import { parseVariantAttributes } from "@/lib/utils/variant-attributes";
import { revalidatePath } from "next/cache";
import { verifyStaff } from "@/lib/security/roles";

/**
 * Shape a Prisma variant (+ product + inventory levels) into exactly the
 * plain object ScanStationClient reads: snake_case scalars, `product`,
 * and `inventory_levels[].warehouse`. Decimals become plain numbers so
 * the result can cross the server → client boundary.
 */
function mapScannedVariant(v: any) {
  if (!v) return null;
  const product = v.product ?? null;
  // REG-48: surface size/colour as first-class fields (parsed with the
  // shared attribute parser) so the scan result card can show them as
  // their own labelled lines instead of leaving staff to decode the SKU.
  const parsedAttrs = parseVariantAttributes(v.attributes ?? {});
  return {
    id: v.id,
    sku: v.sku,
    barcode: v.barcode ?? null,
    size: parsedAttrs.size,
    color: parsedAttrs.color,
    price_override:
      v.priceOverride !== null && v.priceOverride !== undefined
        ? Number(v.priceOverride)
        : null,
    sale_price:
      v.salePrice !== null && v.salePrice !== undefined
        ? Number(v.salePrice)
        : null,
    attributes: v.attributes ?? {},
    product: product
      ? {
          id: product.id,
          name: product.name,
          slug: product.slug,
          base_price: Number(product.basePrice ?? 0),
          status: product.status,
          sku: product.sku ?? null,
        }
      : null,
    inventory_levels: (v.inventoryLevels || []).map((l: any) => ({
      id: l.id,
      quantity_available: l.quantityAvailable,
      quantity_reserved: l.quantityReserved,
      reorder_point: l.reorderPoint,
      warehouse_id: l.warehouseId,
      warehouse: l.warehouse
        ? {
            id: l.warehouse.id,
            name: l.warehouse.name,
            code: l.warehouse.code || "",
            warehouse_code: l.warehouse.code || "",
          }
        : null,
    })),
  };
}

const scannedVariantInclude = {
  product: {
    select: { id: true, name: true, slug: true, basePrice: true, status: true, sku: true },
  },
  inventoryLevels: {
    include: {
      warehouse: { select: { id: true, name: true, code: true } },
    },
  },
} as const;

export async function lookupBarcodeAction(query: string) {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    const trimmed = escapeLikeWildcards(query.trim()); // REG-43: staff-typed codes match literally
    if (!trimmed) {
      return { success: false, error: "Please enter a barcode or SKU to search." };
    }

    // REG-42: Prisma is the reliable path here. The fluent builder
    // (createAdminDbClient) silently DROPS embedded relations from its
    // select strings — the old query below resolved the variant row but
    // returned no `product` and no `inventory_levels`, so the Scan Station
    // rendered "Product" with "No inventory levels recorded" for every
    // real barcode (same failure the Stock Control page comment records).
    // 1. Search variant by barcode or SKU (contains, case-insensitive —
    //    same semantics as the previous `barcode.ilike.%q%,sku.ilike.%q%`).
    let variant: any = await prisma.variant.findFirst({
      where: {
        OR: [
          { barcode: { contains: trimmed, mode: "insensitive" } },
          { sku: { contains: trimmed, mode: "insensitive" } },
        ],
      },
      include: scannedVariantInclude,
    });

    if (!variant) {
      // Try searching product SKU if variant not directly matched
      const product = await prisma.product.findFirst({
        where: { sku: { contains: trimmed, mode: "insensitive" } },
        select: { id: true },
      });

      if (product) {
        variant = await prisma.variant.findFirst({
          where: { productId: product.id },
          include: scannedVariantInclude,
        });
      }
    }

    if (!variant) {
      return {
        success: false,
        error: `No product or variant found matching "${query.trim()}".`,
      };
    }

    // Fetch all active warehouses for quick adjustment dropdown
    const rawWarehouses = await prisma.warehouse.findMany({
      where: { isActive: true },
      select: { id: true, name: true, code: true },
    });

    const warehouses = rawWarehouses.map((w) => ({
      id: w.id,
      name: w.name,
      code: w.code || "",
      warehouse_code: w.code || "",
    }));

    return {
      success: true,
      data: {
        variant: mapScannedVariant(variant),
        warehouses,
      },
    };
  } catch (err: any) {
    console.error("[lookupBarcodeAction]", err);
    return { success: false, error: err.message || "Failed to lookup barcode" };
  }
}

export async function adjustScannedStockAction({
  variantId,
  warehouseId,
  deltaQuantity,
  movementType = "IN",
  note,
}: {
  variantId: string;
  warehouseId: string;
  deltaQuantity: number;
  movementType?: "IN" | "OUT" | "ADJUSTMENT";
  note?: string;
}) {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    if (!variantId || !warehouseId) {
      return { success: false, error: "Variant and warehouse must be specified." };
    }

    if (deltaQuantity === 0) {
      return { success: false, error: "Adjustment quantity cannot be zero." };
    }

    const db = createAdminDbClient();

    // 1. Fetch current inventory level
    const { data: currentLevel } = await db
      .from("inventory_levels")
      .select("id, quantity_available, quantity_reserved")
      .eq("variant_id", variantId)
      .eq("warehouse_id", warehouseId)
      .maybeSingle();

    const prevQty = currentLevel?.quantity_available || 0;
    let newQty: number;

    if (movementType === "IN") {
      newQty = prevQty + Math.abs(deltaQuantity);
    } else if (movementType === "OUT") {
      newQty = Math.max(0, prevQty - Math.abs(deltaQuantity));
    } else {
      // ADJUSTMENT: deltaQuantity represents absolute change (+ or -) or target
      newQty = Math.max(0, prevQty + deltaQuantity);
    }

    // 2. Upsert inventory level
    if (currentLevel?.id) {
      const { error: updErr } = await db
        .from("inventory_levels")
        .update({
          quantity_available: newQty,
          updated_at: new Date().toISOString(),
        })
        .eq("id", currentLevel.id);

      if (updErr) throw updErr;
    } else {
      const { error: insErr } = await db.from("inventory_levels").insert({
        variant_id: variantId,
        warehouse_id: warehouseId,
        quantity_available: newQty,
        quantity_reserved: 0,
        reorder_point: 5,
      });

      if (insErr) throw insErr;
    }

    // 3. Record stock movement
    const actualDelta = newQty - prevQty;
    try {
      await db.from("stock_movements").insert({
        variant_id: variantId,
        warehouse_id: warehouseId,
        quantity_change: actualDelta,
        reason: note || `Scan station quick ${movementType.toLowerCase()} (${actualDelta > 0 ? "+" : ""}${actualDelta})`,
        reason_code: movementType,
        reference_id: "SCAN-STATION",
      });
    } catch (e: any) {
      console.warn("Could not insert stock_movements log:", e?.message);
    }

    revalidatePath("/admin/operations/scan");
    revalidatePath("/admin/inventory/stock");
    revalidatePath("/admin/inventory/movement");

    return {
      success: true,
      data: {
        previousQuantity: prevQty,
        newQuantity: newQty,
        delta: actualDelta,
      },
    };
  } catch (err: any) {
    console.error("[adjustScannedStockAction]", err);
    return { success: false, error: err.message || "Failed to adjust stock" };
  }
}
