import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/store/products — flattened product feed for the /store page.
 *
 * Phase 4 fix: this queried a Supabase-era `store_products` view through
 * the db layer. That table does not exist in the Prisma field map, so
 * every query resolved to an empty success and the /store page rendered
 * zero products. The feed is now built from the real catalog tables.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category');
  const search = searchParams.get('search');
  const featured = searchParams.get('featured');
  // FIX ROUND 29 (D1): explicit id list (comma-separated UUIDs) — the
  // guest wishlist page resolves its locally saved product ids through
  // this feed. Non-UUID segments are ignored.
  const idsParam = searchParams.get('ids');
  const ids = idsParam
    ? idsParam
        .split(',')
        .map((s) => s.trim())
        .filter((s) =>
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
        )
        .slice(0, 100)
    : [];

  // REG-84: bound the feed. Defaults (limit 500) sit far above the
  // current catalog size, so today's response is byte-identical; the
  // cap only bites as the catalog grows. Callers may page explicitly
  // with ?limit=&offset= (limit clamped to 1000).
  const limitParam = Number(searchParams.get('limit'));
  const offsetParam = Number(searchParams.get('offset'));
  const take =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(Math.floor(limitParam), 1000)
      : 500;
  const skip =
    Number.isFinite(offsetParam) && offsetParam > 0
      ? Math.floor(offsetParam)
      : 0;

  try {
    const products = await prisma.product.findMany({
      take,
      skip,
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        ...(ids.length > 0 ? { id: { in: ids } } : {}),
        ...(featured === 'true' ? { isFeatured: true } : {}),
        ...(search
          ? { name: { contains: search, mode: 'insensitive' as const } }
          : {}),
        ...(category && category !== 'All'
          ? { category: { name: { equals: category, mode: 'insensitive' as const } } }
          : {}),
      },
      include: { category: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(
      products.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        price: Number(p.basePrice ?? 0),
        sale_price: p.salePrice != null ? Number(p.salePrice) : null,
        vat_percent: Number(p.vatPercent ?? 0),
        category: p.category?.name || 'General',
        image_url: p.imageUrl || '/placeholder.webp',
        is_featured: p.isFeatured,
      }))
    );
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
