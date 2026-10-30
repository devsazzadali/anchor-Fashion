/**
 * ROUND 14 acceptance proof (REG-42) — read-only, no DB writes.
 *
 * Exercises the SAME data paths the admin UI uses:
 *  A. Scan Station: lookupBarcodeAction's Prisma query (identical where/
 *     include + return mapping). Only the verifyStaff() auth wrapper is
 *     skipped — it needs a request session. (Pre-fix, this section ran the
 *     old fluent-builder query and FAILED on product/stock embeds — the
 *     builder silently drops embedded relations; see the round report.)
 *  B. Stock Control: the page's Prisma fetch (stock/page.tsx mapVariant
 *     shape) + the client's NEW filter predicate, verbatim.
 *  C. Inventory catalog: the master list fetch shape (products + variants)
 *     + InventoryMasterHubClient's NEW filter predicate, verbatim.
 *  D. Partial-barcode sanity on all three paths.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const FULL = "8942079890347";
const PARTIAL = "8942079";
const EXPECT_SKU = "AF-PAN-WHT-04-WHT-38";

let failures = 0;
function check(name: string, ok: boolean, details: string) {
  console.log(`${ok ? "✅" : "❌"} ${name}: ${details}`);
  if (!ok) failures++;
}

async function main() {
  const { prisma } = await import("../lib/prisma");

  // ── A. Scan Station path — lookupBarcodeAction's NEW Prisma query ────────
  // (The action itself can't be invoked here: verifyStaff() needs a request
  // session. This runs its exact where/include + the same snake_case mapping
  // the action applies before returning to ScanStationClient.)
  const rawVariant: any = await prisma.variant.findFirst({
    where: {
      OR: [
        { barcode: { contains: FULL, mode: "insensitive" } },
        { sku: { contains: FULL, mode: "insensitive" } },
      ],
    },
    include: {
      product: {
        select: { id: true, name: true, slug: true, basePrice: true, status: true, sku: true },
      },
      inventoryLevels: {
        include: { warehouse: { select: { id: true, name: true, code: true } } },
      },
    },
  });
  const variant = rawVariant
    ? {
        id: rawVariant.id,
        sku: rawVariant.sku,
        barcode: rawVariant.barcode ?? null,
        price_override: rawVariant.priceOverride != null ? Number(rawVariant.priceOverride) : null,
        sale_price: rawVariant.salePrice != null ? Number(rawVariant.salePrice) : null,
        attributes: rawVariant.attributes ?? {},
        product: rawVariant.product
          ? {
              id: rawVariant.product.id,
              name: rawVariant.product.name,
              slug: rawVariant.product.slug,
              base_price: Number(rawVariant.product.basePrice ?? 0),
              status: rawVariant.product.status,
              sku: rawVariant.product.sku ?? null,
            }
          : null,
        inventory_levels: (rawVariant.inventoryLevels || []).map((l: any) => ({
          id: l.id,
          quantity_available: l.quantityAvailable,
          quantity_reserved: l.quantityReserved,
          reorder_point: l.reorderPoint,
          warehouse_id: l.warehouseId,
          warehouse: l.warehouse
            ? { id: l.warehouse.id, name: l.warehouse.name, code: l.warehouse.code || "", warehouse_code: l.warehouse.code || "" }
            : null,
        })),
      }
    : null;
  const prodA: any = variant?.product;
  const levelsA: any[] = variant?.inventory_levels || [];
  const centralA = levelsA.find((l: any) => l.warehouse?.name === "Central Warehouse");
  check(
    "A1 scan-station resolves variant",
    variant?.sku === EXPECT_SKU && variant?.barcode === FULL,
    `sku=${variant?.sku} barcode=${variant?.barcode}`
  );
  check(
    "A2 scan-station resolves product",
    prodA?.name === "White Classic Cotton Panjabi",
    `product=${prodA?.name}`
  );
  check(
    "A3 scan-station resolves stock",
    centralA?.quantity_available === 11,
    `Central Warehouse available=${centralA?.quantity_available} (levels: ${levelsA
      .map((l: any) => {
        const w = Array.isArray(l.warehouse) ? l.warehouse[0] : l.warehouse;
        return `${w?.name}=${l.quantity_available}`;
      })
      .join(", ")})`
  );
  console.log(
    `    attributes=${JSON.stringify(variant?.attributes)}`
  );

  // ── Shared Prisma fetch (same shape as the two list pages) ───────────────
  const [levels, warehouses, variants] = await Promise.all([
    prisma.inventoryLevel.findMany(),
    prisma.warehouse.findMany(),
    prisma.variant.findMany({
      include: {
        product: { select: { id: true, name: true, sku: true } },
      },
    }),
  ]);
  const variantById = new Map(variants.map((v: any) => [v.id, v]));
  const warehouseById = new Map(warehouses.map((w: any) => [w.id, w]));

  // ── B. Stock Control path — page rows + NEW client predicate (verbatim) ──
  const stockRows = levels.map((level: any) => {
    const v: any = variantById.get(level.variantId) ?? null;
    const wh: any = warehouseById.get(level.warehouseId) ?? null;
    return {
      id: level.id,
      quantity_available: level.quantityAvailable,
      variants: v
        ? {
            id: v.id,
            sku: v.sku,
            barcode: v.barcode ?? null,
            product: v.product
              ? { id: v.product.id, name: v.product.name, sku: v.product.sku }
              : null,
          }
        : null,
      warehouses: wh ? { id: wh.id, name: wh.name } : null,
    };
  });

  function stockMatches(item: any, search: string) {
    const sku = item.variants?.sku?.toLowerCase() || "";
    const barcode = item.variants?.barcode?.toLowerCase() || "";
    const name = (item.variants?.product?.name || item.variants?.name || "").toLowerCase();
    const warehouse = item.warehouses?.name?.toLowerCase() || "";
    const query = search.toLowerCase();
    return !search || sku.includes(query) || barcode.includes(query) || name.includes(query) || warehouse.includes(query);
  }

  const stockHits = stockRows.filter((r: any) => stockMatches(r, FULL));
  const bRow = stockHits[0];
  check(
    "B1 stock-control resolves exact barcode",
    stockHits.length === 1 && bRow?.variants?.sku === EXPECT_SKU,
    `hits=${stockHits.length} sku=${bRow?.variants?.sku}`
  );
  check(
    "B2 stock-control row is Central Warehouse / 11 available",
    bRow?.warehouses?.name === "Central Warehouse" && bRow?.quantity_available === 11,
    `warehouse=${bRow?.warehouses?.name} available=${bRow?.quantity_available}`
  );

  // ── C. Catalog path — master items + NEW client predicate (verbatim) ─────
  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    include: {
      category: { select: { name: true } },
      variants: { select: { sku: true, barcode: true } },
    },
  });
  const masterItems = products.map((p: any) => ({
    name: p.name,
    sku: p.sku || "N/A",
    barcode: p.barcode || "N/A",
    category: p.category?.name || "Uncategorized",
    variants: p.variants.map((v: any) => ({ sku: v.sku, barcode: v.barcode })),
  }));

  function catalogMatches(item: any, search: string) {
    const q = search.toLowerCase();
    return (
      !search ||
      item.name?.toLowerCase().includes(q) ||
      item.sku?.toLowerCase().includes(q) ||
      item.barcode?.toLowerCase().includes(q) ||
      (item.variants || []).some(
        (v: any) =>
          v.barcode?.toLowerCase().includes(q) ||
          v.sku?.toLowerCase().includes(q)
      ) ||
      item.category?.toLowerCase().includes(q)
    );
  }

  const catHits = masterItems.filter((it: any) => catalogMatches(it, FULL));
  check(
    "C1 catalog resolves exact barcode to its product",
    catHits.length === 1 && catHits[0]?.name === "White Classic Cotton Panjabi",
    `hits=${catHits.length} product=${catHits[0]?.name} (catalog size=${masterItems.length})`
  );
  // Variant-SKU search must also surface the product now (same predicate).
  const catSkuHits = masterItems.filter((it: any) => catalogMatches(it, EXPECT_SKU));
  check(
    "C2 catalog resolves full variant SKU too",
    catSkuHits.length === 1 && catSkuHits[0]?.name === "White Classic Cotton Panjabi",
    `hits=${catSkuHits.length}`
  );

  // ── D. Partial-barcode sanity ─────────────────────────────────────────────
  const partialStock = stockRows.filter((r: any) => stockMatches(r, PARTIAL));
  const partialCat = masterItems.filter((it: any) => catalogMatches(it, PARTIAL));
  const partialVariant = await prisma.variant.findFirst({
    where: {
      OR: [
        { barcode: { contains: PARTIAL, mode: "insensitive" } },
        { sku: { contains: PARTIAL, mode: "insensitive" } },
      ],
    },
    select: { id: true, sku: true, barcode: true },
  });
  check(
    "D1 partial barcode stays bounded",
    partialStock.length > 0 && partialStock.length <= 25 && partialCat.length <= 25,
    `prefix "${PARTIAL}": stock rows=${partialStock.length}, catalog products=${partialCat.length}, scan-station limit(1) → ${partialVariant ? 1 : 0} (by design)`
  );

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("PROOF ERROR:", e);
  process.exit(2);
});
