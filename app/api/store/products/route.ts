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
    console.error('Unexpected error fetching products:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
