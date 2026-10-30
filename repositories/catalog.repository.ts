import { prisma } from "@/lib/prisma";
import { PromotionRepository } from "@/lib/repositories/marketing/promotion.repository";
import { priceWithVat } from "@/lib/utils/vat";

/**
 * The unit price a product card actually displays: the effective selling
 * price (sale price when set, else base price — mapProductToStorefront has
 * already folded any active promotion into sale_price) with the product's
 * VAT added on top. Mirrors components/product/product-card.tsx exactly so
 * price sorting orders by what the customer sees.
 */
function displayedUnitPrice(p: any): number {
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

function mapProductToStorefront(p: any, activePromoDiscount?: number | null) {
  if (!p) return null;

  const variants = p.variants || [];
  const totalAvailable = variants.reduce(
    (sum: number, variant: any) => {
      const variantStock = (variant.inventoryLevels || []).reduce(
        (vSum: number, level: any) => vSum + (level.quantityAvailable || 0),
        0
      );
      return sum + variantStock;
    },
    0
  );

  const mediaList = (p.media || []).map((m: any) => ({
    id: m.id,
    url: m.url,
    url_webp: m.urlWebp,
    alt_text: m.altText,
    is_primary: m.isPrimary,
    display_order: m.displayOrder,
    media_type: m.mediaType,
  }));

  const primaryMedia = mediaList.find((m: any) => m.is_primary) || mediaList[0] || null;

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
    cost_price: p.costPrice ? Number(p.costPrice) : null,
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
    category_ids: (p.productCategories || []).map((pc: any) => pc.categoryId).filter(Boolean),
    additional_categories: (p.productCategories || [])
      .map((pc: any) => (pc.category ? { id: pc.category.id, name: pc.category.name, slug: pc.category.slug } : null))
      .filter(Boolean),
    brand: p.brand ? { id: p.brand.id, name: p.brand.name, slug: p.brand.slug } : null,
    brands: p.brand ? { id: p.brand.id, name: p.brand.name, slug: p.brand.slug } : null,
    product_media: mediaList,
    media: mediaList,
    primary_image_url: primaryMedia ? primaryMedia.url : p.imageUrl || "/placeholder.png",
    variants: variants.map((v: any) => ({
      id: v.id,
      sku: v.sku,
      barcode: v.barcode,
      price_override: v.priceOverride ? Number(v.priceOverride) : null,
      sale_price: v.salePrice ? Number(v.salePrice) : null,
      weight: v.weight ? Number(v.weight) : null,
      attributes: v.attributes,
      is_active: v.isActive,
      inventory_levels: (v.inventoryLevels || []).map((il: any) => ({
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
      console.error("Error fetching categories from Neon:", e);
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
      console.error("Error fetching filter facets from Neon:", error);
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
        .filter((p): p is NonNullable<typeof p> => p !== null) as any;
    } catch (e) {
      console.error("Error fetching featured products from Neon:", e);
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
        .filter((p): p is NonNullable<typeof p> => p !== null) as any;
    } catch (e) {
      console.error("Error fetching new arrivals from Neon:", e);
      return [];
    }
  },

  /**
   * Fetch filtered & paginated products from Neon PostgreSQL
   */
  async getProducts(params: ProductListParams) {
    try {
      const andClauses: any[] = [
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
        const priceFilter: any = {};
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
        const variantConds: any[] = [];
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
        const term = params.search.trim();
        andClauses.push({
          OR: [
            { name: { contains: term, mode: "insensitive" } },
            { description: { contains: term, mode: "insensitive" } },
            { shortDescription: { contains: term, mode: "insensitive" } },
            { sku: { contains: term, mode: "insensitive" } },
            { barcode: { contains: term, mode: "insensitive" } },
            { variants: { some: { sku: { contains: term, mode: "insensitive" } } } },
            { variants: { some: { barcode: { contains: term, mode: "insensitive" } } } },
          ],
        });
      }

      const where: any = { AND: andClauses };

      let orderBy: any = { createdAt: "desc" };
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
          ...(isPriceSort ? {} : { take: limit, skip: offset }),
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
          .sort((a: any, b: any) => {
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

      return {
        data: mapped,
        count: total,
      };
    } catch (error) {
      console.error("Error fetching products from Neon:", error);
      return { data: [], count: 0 };
    }
  },

  /**
   * Fetch single product by slug from Neon PostgreSQL
   */
  async getProductBySlug(slug: string): Promise<any> {
    try {
      const [product, bestPromo] = await Promise.all([
        prisma.product.findFirst({
          where: {
            OR: [
              { slug },
              { sku: { equals: slug, mode: "insensitive" } },
            ],
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
      console.error("Error fetching product by slug from Neon:", error);
      return null;
    }
  },
};
