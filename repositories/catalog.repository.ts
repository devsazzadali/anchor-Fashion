import { prisma } from "@/lib/prisma";
import { PromotionRepository } from "@/lib/repositories/marketing/promotion.repository";
import { priceWithVat } from "@/lib/utils/vat";
import { escapeLikeWildcards } from "@/lib/utils/like-escape";
import { expandSearchTerms } from "@/lib/utils/bengali-search";
import { Prisma } from "@prisma/client";

/**
 * REG-65 batch 1: the Prisma product row the storefront mapper
 * consumes — exactly the include set every list query in this file
 * fetches (getProductBySlug's wider include is a structural
 * superset, and its null case is checked before the call).
 */
type StorefrontProductRow = Prisma.ProductGetPayload<{
  include: {
    category: { select: { id: true; name: true; slug: true } };
    brand: { select: { id: true; name: true; slug: true } };
    productCategories: {
      include: { category: { select: { id: true; name: true; slug: true } } };
    };
    media: true;
    variants: { include: { inventoryLevels: true } };
  };
}>;

/** The mapped storefront DTO the list helpers sort / price on. */
type StorefrontProduct = NonNullable<
  ReturnType<typeof mapProductToStorefront>
>;

/**
 * The unit price a product card actually displays: the effective selling
 * price (sale price when set, else base price — mapProductToStorefront has
 * already folded any active promotion into sale_price) with the product's
 * VAT added on top. Mirrors components/product/product-card.tsx exactly so
 * price sorting orders by what the customer sees.
 */
function displayedUnitPrice(
  p: {
    sale_price?: number | null;
    base_price?: number | null;
    vat_percent?: number | null;
  } | null | undefined
): number {
  const price = Number(p?.sale_price ?? p?.base_price ?? 0);
  return priceWithVat(price, Number(p?.vat_percent ?? 0));
}

export interface ProductListParams {
  category?: string;
  brand?: string;
  minPrice?: number;
  maxPrice?: number;
  search?: string;
  sortBy?: "price_asc" | "price_desc" | "newest" | "rating";
  limit?: number;
  offset?: number;
  /** Selected size facet values (variant attributes Size/size). */
  sizes?: string[];
  /** Selected colour facet values (variant attributes Color/Colour). */
  colors?: string[];
}

function mapProductToStorefront(
  p: StorefrontProductRow,
  activePromoDiscount?: number | null
) {
  if (!p) return null;

  const variants = p.variants || [];

  // Purchasable stock per variant: units available across all of the
  // variant's warehouse levels. Reserved units are already excluded —
  // reserving stock decrements quantity_available (InventoryService).
  // This per-variant figure is computed once, here on the server, and is
  // the only stock number the storefront displays; the product total is
  // simply its sum.
  const variantAvailableStock = variants.map((variant) =>
    (variant.inventoryLevels || []).reduce(
      (vSum: number, level) => vSum + (level.quantityAvailable || 0),
      0
    )
  );
  const totalAvailable = variantAvailableStock.reduce(
    (sum: number, n: number) => sum + n,
    0
  );

  const mediaList = (p.media || []).map((m) => ({
    id: m.id,
    url: m.url,
    url_webp: m.urlWebp,
    alt_text: m.altText,
    is_primary: m.isPrimary,
    display_order: m.displayOrder,
    media_type: m.mediaType,
  }));

  const primaryMedia = mediaList.find((m) => m.is_primary) || mediaList[0] || null;

  const basePriceNum = Number(p.basePrice);
  let salePriceNum = p.salePrice ? Number(p.salePrice) : null;

  // If there is an active promotion and no lower custom sale price, apply the promotional discount percentage!
  if (activePromoDiscount && activePromoDiscount > 0) {
    const promoDiscountedPrice = Math.round(basePriceNum * (1 - activePromoDiscount / 100));
    if (salePriceNum === null || promoDiscountedPrice < salePriceNum) {
      salePriceNum = promoDiscountedPrice;
    }
  }

  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    short_description: p.shortDescription,
    shortDescription: p.shortDescription,
    base_price: basePriceNum,
    basePrice: basePriceNum,
    sale_price: salePriceNum,
    salePrice: salePriceNum,
    vat_percent: Number(p.vatPercent || 0),
    vatPercent: Number(p.vatPercent || 0),
    // FIX2 (R30 OBS-5 class): cost_price deliberately NOT mapped. This
    // DTO is serialized into every public storefront payload (home,
    // listing, PDP, search), so the wholesale cost was readable by any
    // visitor in the page source. Admin cost views use their own
    // procurement/inventory queries, never this mapper.
    sku: p.sku,
    barcode: p.barcode,
    status: p.status,
    gender: p.gender,
    season: p.season,
    care_instructions: p.careInstructions,
    country_of_origin: p.countryOfOrigin,
    is_featured: p.isFeatured,
    isFeatured: p.isFeatured,
    average_rating: Number(p.rating || 0),
    rating: Number(p.rating || 0),
    review_count: p.reviewCount || 0,
    created_at: p.createdAt ? new Date(p.createdAt).toISOString() : new Date().toISOString(),
    updated_at: p.updatedAt ? new Date(p.updatedAt).toISOString() : new Date().toISOString(),
    category_id: p.categoryId,
    brand_id: p.brandId,
    category: p.category ? { id: p.category.id, name: p.category.name, slug: p.category.slug } : null,
    categories: p.category ? { id: p.category.id, name: p.category.name, slug: p.category.slug } : null,
    category_ids: (p.productCategories || []).map((pc) => pc.categoryId).filter(Boolean),
    additional_categories: (p.productCategories || [])
      .map((pc) => (pc.category ? { id: pc.category.id, name: pc.category.name, slug: pc.category.slug } : null))
      .filter(Boolean),
    brand: p.brand ? { id: p.brand.id, name: p.brand.name, slug: p.brand.slug } : null,
    brands: p.brand ? { id: p.brand.id, name: p.brand.name, slug: p.brand.slug } : null,
    product_media: mediaList,
    media: mediaList,
    primary_image_url: primaryMedia ? primaryMedia.url : p.imageUrl || "/placeholder.png",
    variants: variants.map((v, variantIndex: number) => ({
      id: v.id,
      sku: v.sku,
      barcode: v.barcode,
      price_override: v.priceOverride ? Number(v.priceOverride) : null,
      sale_price: v.salePrice ? Number(v.salePrice) : null,
      weight: v.weight ? Number(v.weight) : null,
      attributes: v.attributes,
      is_active: v.isActive,
      // Server-computed purchasable stock for THIS variant (see above).
      available_stock: variantAvailableStock[variantIndex],
      inventory_levels: (v.inventoryLevels || []).map((il) => ({
        id: il.id,
        warehouse_id: il.warehouseId,
        quantity_available: il.quantityAvailable,
        quantity_reserved: il.quantityReserved,
        reorder_point: il.reorderPoint,
      })),
    })),
    is_in_stock: totalAvailable > 0 || (variants.length === 0 && p.status === "ACTIVE"),
    total_available_stock: totalAvailable,
    stockQuantity: totalAvailable,
  };
}

export const CatalogRepository = {
  /**
   * Fetch active categories from Neon PostgreSQL
   */
  async getCategories() {
    try {
      const categories = await prisma.category.findMany({
        where: { isActive: true },
        orderBy: { displayOrder: "asc" },
      });
      return categories.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        description: c.description ?? "",
        image_url: c.imageUrl ?? null,
        image: c.imageUrl ?? "",
        parent_id: c.parentId ?? null,
        icon_url: c.imageUrl ?? null,
        display_order: c.displayOrder,
        sortOrder: c.displayOrder,
        is_active: c.isActive,
        isActive: c.isActive,
        created_at: c.createdAt ? new Date(c.createdAt).toISOString() : new Date().toISOString(),
        updated_at: c.updatedAt ? new Date(c.updatedAt).toISOString() : new Date().toISOString(),
      }));
    } catch (e) {
      return [];
    }
  },

  /**
   * Distinct size / colour facet values across variants of ACTIVE
   * products, read from the real variant attribute JSON (keys are not
   * uniform: "Size"/"size", "Color"/"color"/"Colour"/"colour").
   */
  async getFilterFacets(): Promise<{ sizes: string[]; colors: string[] }> {
    try {
      const variants = await prisma.variant.findMany({
        where: {
          isActive: true,
          product: { status: "ACTIVE", deletedAt: null },
        },
        select: { attributes: true },
      });
      const sizes = new Set<string>();
      const colors = new Set<string>();
      for (const v of variants) {
        const a = (v.attributes ?? {}) as Record<string, any>;
        const size = a.Size ?? a.size;
        const color = a.Color ?? a.color ?? a.Colour ?? a.colour;
        if (size !== undefined && size !== null && String(size).trim() !== "") {
          sizes.add(String(size));
        }
        if (
          color !== undefined &&
          color !== null &&
          String(color).trim() !== ""
        ) {
          colors.add(String(color));
        }
      }
      const sizeList = [...sizes].sort((x, y) => {
        const nx = parseFloat(x);
        const ny = parseFloat(y);
        if (!Number.isNaN(nx) && !Number.isNaN(ny)) return nx - ny;
        return x.localeCompare(y);
      });
      return { sizes: sizeList, colors: [...colors].sort((x, y) => x.localeCompare(y)) };
    } catch (error) {
      return { sizes: [], colors: [] };
    }
  },

  /**
   * Fetch featured products from Neon PostgreSQL
   */
  /**
   * Fetch featured products from Neon PostgreSQL
   */
  async getFeaturedProducts(limit = 4) {
    try {
      const [products, bestPromo] = await Promise.all([
        prisma.product.findMany({
          where: {
            status: "ACTIVE",
            isFeatured: true,
            deletedAt: null,
          },
          include: {
            category: { select: { id: true, name: true, slug: true } },
            brand: { select: { id: true, name: true, slug: true } },
            productCategories: {
              include: {
                category: { select: { id: true, name: true, slug: true } },
              },
            },
            media: { orderBy: { displayOrder: "asc" } },
            variants: { include: { inventoryLevels: true } },
          },
          orderBy: { createdAt: "desc" },
          take: limit,
        }),
        PromotionRepository.getBestActivePromotion().catch(() => null),
      ]);

      const promoDiscount = bestPromo?.discount_percentage ?? null;
      return products
        .map((p) => mapProductToStorefront(p, promoDiscount))
        .filter((p): p is NonNullable<typeof p> => p !== null);
    } catch (e) {
      return [];
    }
  },

  /**
   * Fetch new arrival products from Neon PostgreSQL
   */
  async getNewArrivals(limit = 4) {
    try {
      const [products, bestPromo] = await Promise.all([
        prisma.product.findMany({
          where: {
            status: "ACTIVE",
            deletedAt: null,
          },
          include: {
            category: { select: { id: true, name: true, slug: true } },
            brand: { select: { id: true, name: true, slug: true } },
            productCategories: {
              include: {
                category: { select: { id: true, name: true, slug: true } },
              },
            },
            media: { orderBy: { displayOrder: "asc" } },
            variants: { include: { inventoryLevels: true } },
          },
          orderBy: { createdAt: "desc" },
          take: limit,
        }),
        PromotionRepository.getBestActivePromotion().catch(() => null),
      ]);

      const promoDiscount = bestPromo?.discount_percentage ?? null;
      return products
        .map((p) => mapProductToStorefront(p, promoDiscount))
        .filter((p): p is NonNullable<typeof p> => p !== null);
    } catch (e) {
      return [];
    }
  },

  /**
   * Fetch filtered & paginated products from Neon PostgreSQL
   */
  async getProducts(params: ProductListParams) {
    try {
      const andClauses: Prisma.ProductWhereInput[] = [
        { status: "ACTIVE" },
        { deletedAt: null },
      ];

      if (params.category) {
        const catSlug = params.category.toLowerCase().trim();
        if (catSlug === "sale") {
          andClauses.push({ salePrice: { not: null } });
        } else {
          // Phase 9: subtree aggregation — a category page lists products
          // from the category itself plus its children and grandchildren,
          // resolved from the DB tree by ID. The previous men/women/kids
          // branches hardcoded slug lists for categories that do not exist
          // in this catalog; unknown slugs now honestly return no products.
          const root = await prisma.category.findFirst({
            where: { slug: catSlug },
            select: { id: true },
          });
          let subtreeIds: string[] = [];
          if (root) {
            const children = await prisma.category.findMany({
              where: { parentId: root.id },
              select: { id: true },
            });
            const childIds = children.map((c) => c.id);
            const grandchildren = childIds.length
              ? await prisma.category.findMany({
                  where: { parentId: { in: childIds } },
                  select: { id: true },
                })
              : [];
            subtreeIds = [root.id, ...childIds, ...grandchildren.map((g) => g.id)];
          }
          andClauses.push({
            OR: [
              { categoryId: { in: subtreeIds } },
              { productCategories: { some: { categoryId: { in: subtreeIds } } } },
            ],
          });
        }
      }
      if (params.brand) {
        andClauses.push({ brand: { slug: params.brand } });
      }
      if (params.minPrice !== undefined || params.maxPrice !== undefined) {
        const priceFilter: Prisma.DecimalFilter = {};
        if (params.minPrice !== undefined) priceFilter.gte = params.minPrice;
        if (params.maxPrice !== undefined) priceFilter.lte = params.maxPrice;
        andClauses.push({ basePrice: priceFilter });
      }
      // Size / colour facets: a product qualifies when ONE active variant
      // matches every selected facet group (values within a group are OR).
      // Variant attribute keys are not uniform in the catalog data ("Size"
      // and "size" both occur; colours are stored under "Color"), so each
      // value is checked against every known key spelling.
      const SIZE_KEYS = ["Size", "size"];
      const COLOR_KEYS = ["Color", "color", "Colour", "colour"];
      if (params.sizes?.length || params.colors?.length) {
        const variantConds: Prisma.VariantWhereInput[] = [];
        if (params.sizes?.length) {
          variantConds.push({
            OR: params.sizes.flatMap((s) =>
              SIZE_KEYS.map((k) => ({ attributes: { path: [k], equals: s } }))
            ),
          });
        }
        if (params.colors?.length) {
          variantConds.push({
            OR: params.colors.flatMap((c) =>
              COLOR_KEYS.map((k) => ({ attributes: { path: [k], equals: c } }))
            ),
          });
        }
        andClauses.push({
          variants: { some: { isActive: true, AND: variantConds } },
        });
      }
      if (params.search && params.search.trim()) {
        // REG-43: escape LIKE wildcards in the shopper's term — Prisma
        // `contains` becomes a Postgres LIKE pattern and an unescaped
        // "%" or "_" in the term acted as a wildcard (searching "%"
        // returned the whole catalog).
        // A3-C8: expandSearchTerms adds the Latin transliteration for
        // Bengali-script queries ("পাঞ্জাবি" → also "panjabi"), which
        // previously returned 0 products against the Latin catalog.
        const terms = expandSearchTerms(params.search).map((t) =>
          escapeLikeWildcards(t)
        );
        andClauses.push({
          OR: terms.flatMap((term) => [
            { name: { contains: term, mode: "insensitive" } },
            { description: { contains: term, mode: "insensitive" } },
            { shortDescription: { contains: term, mode: "insensitive" } },
            { sku: { contains: term, mode: "insensitive" } },
            { barcode: { contains: term, mode: "insensitive" } },
            { variants: { some: { sku: { contains: term, mode: "insensitive" } } } },
            { variants: { some: { barcode: { contains: term, mode: "insensitive" } } } },
            // FIX ROUND 29 (D2): category names are searchable too — a
            // shopper typing "panjabi" expects the Panjabi category's
            // products even when a name/description lacks the word.
            { category: { name: { contains: term, mode: "insensitive" } } },
            {
              productCategories: {
                some: { category: { name: { contains: term, mode: "insensitive" } } },
              },
            },
          ]),
        });
      }

      const where: Prisma.ProductWhereInput = { AND: andClauses };

      let orderBy: Prisma.ProductOrderByWithRelationInput = { createdAt: "desc" };
      if (params.sortBy === "price_asc") {
        orderBy = { basePrice: "asc" };
      } else if (params.sortBy === "price_desc") {
        orderBy = { basePrice: "desc" };
      } else if (params.sortBy === "rating") {
        orderBy = { rating: "desc" };
      } else {
        orderBy = { createdAt: "desc" };
      }

      const limit = params.limit || 12;
      const offset = params.offset || 0;
      // Price sorts must order by the VAT-inclusive price the cards
      // display, which is a computed value (effective price × (1 + VAT%))
      // that Prisma cannot orderBy. For those two sorts, fetch the full
      // matching set, sort by the displayed price in memory, then page.
      const isPriceSort =
        params.sortBy === "price_asc" || params.sortBy === "price_desc";
      // FIX ROUND 29 (D2): a search with no explicit sort is ranked by
      // relevance (below), not by createdAt — "panjabi" previously
      // returned the newest knitwear first because every description
      // mentioning the word ranked equally. Like the price sorts, the
      // full matching set is fetched and paged in memory; the reported
      // count stays the database total of ALL matches (unchanged).
      const isRelevanceSort = Boolean(params.search?.trim()) && !params.sortBy;

      const [products, total, bestPromo] = await Promise.all([
        prisma.product.findMany({
          where,
          include: {
            category: { select: { id: true, name: true, slug: true } },
            brand: { select: { id: true, name: true, slug: true } },
            productCategories: {
              include: {
                category: { select: { id: true, name: true, slug: true } },
              },
            },
            media: { orderBy: { displayOrder: "asc" } },
            variants: { include: { inventoryLevels: true } },
          },
          orderBy,
          ...(isPriceSort || isRelevanceSort ? {} : { take: limit, skip: offset }),
        }),
        prisma.product.count({ where }),
        PromotionRepository.getBestActivePromotion().catch(() => null),
      ]);

      const promoDiscount = bestPromo?.discount_percentage ?? null;

      let mapped = products.map((p) => mapProductToStorefront(p, promoDiscount));

      if (isPriceSort) {
        const dir = params.sortBy === "price_asc" ? 1 : -1;
        mapped = mapped
          .slice()
          .sort((a, b) => {
            const diff = displayedUnitPrice(a) - displayedUnitPrice(b);
            if (diff !== 0) return diff * dir;
            // Deterministic tie-break: newest first, then id.
            const ca = String(a?.created_at || "");
            const cb = String(b?.created_at || "");
            if (ca !== cb) return cb.localeCompare(ca);
            return String(a?.id || "").localeCompare(String(b?.id || ""));
          })
          .slice(offset, offset + limit);
      }

      if (isRelevanceSort) {
        // Tier ladder: exact name > name prefix > name contains > all
        // query words in the name > category-name match > any other
        // field (description / SKU / barcode). Newest first inside a
        // tier, id as the final deterministic tie-break.
        const term = params.search!.trim().toLowerCase();
        const words = term.split(/\s+/).filter(Boolean);
        const tierOf = (p: StorefrontProduct | null): number => {
          const name = String(p?.name || "").toLowerCase();
          if (name === term) return 0;
          if (name.startsWith(term)) return 1;
          if (name.includes(term)) return 2;
          if (words.length > 1 && words.every((w) => name.includes(w))) return 3;
          const catNames = [
            p?.category?.name,
            ...(p?.additional_categories || []).map((c) => c?.name),
          ]
            .filter((n): n is string => Boolean(n))
            .map((n: string) => n.toLowerCase());
          if (catNames.some((n) => n.includes(term) || words.some((w) => n.includes(w)))) return 4;
          return 5;
        };
        mapped = mapped
          .slice()
          .sort((a, b) => {
            const dt = tierOf(a) - tierOf(b);
            if (dt !== 0) return dt;
            const ca = String(a?.created_at || "");
            const cb = String(b?.created_at || "");
            if (ca !== cb) return cb.localeCompare(ca);
            return String(a?.id || "").localeCompare(String(b?.id || ""));
          })
          .slice(offset, offset + limit);
      }

      return {
        data: mapped,
        count: total,
      };
    } catch (error) {
      return { data: [], count: 0 };
    }
  },

  /**
   * Fetch single product by slug from Neon PostgreSQL
   */
  // REG-65 batch 1 HOLDOUT: the return stays Promise<any> — the PDP
  // page (app/(shop)/products/[slug]/page.tsx) reads seo_title /
  // seo_description off the result, fields the storefront mapper has
  // never included (they are undefined at runtime today). A precise
  // return type forces a page or mapper change — a runtime-visible
  // decision outside this type-only batch.
  async getProductBySlug(slug: string): Promise<any> {
    try {
      const [product, bestPromo] = await Promise.all([
        prisma.product.findFirst({
          where: {
            OR: [
              { slug },
              { sku: { equals: slug, mode: "insensitive" } },
            ],
            // Storefront PDPs must only serve sellable products: without the
            // status filter, ARCHIVED/DRAFT products stayed publicly
            // reachable (and buyable-looking) by direct URL after being
            // deactivated (R30 FIX2, item 8a follow-up).
            status: "ACTIVE",
            deletedAt: null,
          },
          include: {
            category: { select: { id: true, name: true, slug: true } },
            brand: { select: { id: true, name: true, slug: true } },
            productCategories: {
              include: {
                category: { select: { id: true, name: true, slug: true } },
              },
            },
            media: { orderBy: { displayOrder: "asc" } },
            variants: {
              include: {
                inventoryLevels: true,
              },
            },
            seo: true,
            reviews: {
              where: { isApproved: true },
              orderBy: { createdAt: "desc" },
              take: 20,
            },
          },
        }),
        PromotionRepository.getBestActivePromotion().catch(() => null),
      ]);

      if (!product) return null;
      const promoDiscount = bestPromo?.discount_percentage ?? null;
      return mapProductToStorefront(product, promoDiscount);
    } catch (error) {
      return null;
    }
  },
};
