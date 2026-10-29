import {
  getCachedCategories,
  getCachedCollections,
  getCachedProducts,
  getCachedFeaturedProducts,
  getCachedHeroSlides,
  getCachedFeaturedPromoBanner,
  getCachedWhyChooseUs,
  getCachedCuratedCategoriesData,
} from "@/lib/cache/catalog-cache";
import { HomeHero } from "@/components/home/home-hero";
import { CategoryHighlight } from "@/components/home/category-highlight";
import { FeaturesBar } from "@/components/home/features-bar";
import { ExploreCollections } from "@/components/home/explore-collections";
import { FeaturedProducts } from "@/components/home/featured-products";
import { WhyChooseUs } from "@/components/home/why-choose-us";
import { BrandedCollection } from "@/components/home/branded-collection";
import { PromoBanner } from "@/components/home/promo-banner";
import { TrendingProducts } from "@/components/home/trending-products";
import { LatestBlogs } from "@/components/home/latest-blogs";
import { FadeIn } from "@/components/ui/fade-in";
import { FlashSaleService } from "@/lib/services/marketing/flash-sale.service";
import { getPromoSections } from "@/actions/cms.actions";
import {
  getHomepageLayout,
  getFeaturesBarConfig,
} from "@/lib/actions/homepage.actions";
import { HOMEPAGE_SECTIONS } from "@/lib/homepage-shared";
import type { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { Clock, ArrowRight } from "lucide-react";

/**
 * High-Traffic Production Caching (10,000+ Daily Visitors)
 * Revalidates every 60 seconds (ISR) and uses tag-based invalidation.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Home | Anchor Fashion Enterprise",
  description:
    "Discover premium apparel for the modern professional at Anchor Fashion.",
};

export default async function HomePage() {
  // Fetch cached catalog data in parallel with resilient fallbacks
  const [
    categories,
    collections,
    featuredProducts,
    trendingProducts,
    heroSlides,
    activeFlashSales,
    featuredPromoBanner,
    whyChooseUsData,
    curatedCategoriesData,
    promoSections,
    homepageLayout,
    featuresBarConfig,
  ] = await Promise.all([
    getCachedCategories().catch(() => []),
    getCachedCollections().catch(() => []),
    getCachedFeaturedProducts(4).catch(() => []),
    getCachedProducts({ sortBy: "rating", limit: 8 }).catch(() => ({ data: [] })),
    getCachedHeroSlides().catch(() => []),
    FlashSaleService.getActiveFlashSales().catch(() => []),
    getCachedFeaturedPromoBanner().catch(() => null),
    getCachedWhyChooseUs().catch(() => null),
    getCachedCuratedCategoriesData().catch(() => null),
    getPromoSections().catch(() => []),
    getHomepageLayout().catch(() => null),
    getFeaturesBarConfig().catch(() => null),
  ]);

  // Homepage section visibility + ordering (Admin → CMS → Homepage).
  // Sections render within their structural group (top strip under the
  // hero, then the main spaced column) in the admin-defined order.
  const sectionEnabled = (key: string) =>
    !homepageLayout ||
    homepageLayout.sections.find((s) => s.key === key)?.isEnabled !== false;
  const orderedKeys = (group: "top" | "main") => {
    const registryOrder = HOMEPAGE_SECTIONS.filter(
      (s) => s.group === group
    ).map((s) => s.key);
    if (!homepageLayout) return registryOrder;
    const stored = homepageLayout.sections
      .map((s) => s.key)
      .filter((k) => registryOrder.includes(k));
    const missing = registryOrder.filter((k) => !stored.includes(k));
    return [...stored, ...missing];
  };

  // Phase 9 (no-hardcode rule): collection sections are generated from the
  // admin-managed top-level categories in the database. The previous build
  // hardcoded "mens / womens / kids / accessories" sections whose slugs and
  // view-all links did not exist in this menswear catalog.
  const topCategories = (categories as any[])
    .filter((c) => !c.parent_id && c.is_active !== false)
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
    .slice(0, 4);
  const sectionProducts = await Promise.all(
    topCategories.map((c) =>
      getCachedProducts({ category: c.slug, limit: 8 }).catch(() => ({ data: [] }))
    )
  );
  const collectionSections = topCategories
    .map((c, i) => ({ category: c, products: sectionProducts[i]?.data || [] }))
    .filter((s) => s.products.length > 0);

  // Campaign banners beyond the featured one (all CMS-managed).
  const extraPromos = (promoSections || []).filter(
    (p) => p.id !== (featuredPromoBanner as any)?.id
  );

  // ── Homepage blocks, visibility + order from Admin → CMS → Homepage ──
  const topBlocks: Record<string, ReactNode> = {
    features_bar: sectionEnabled("features_bar") ? (
      <FadeIn key="features_bar" delay={0.1} direction="none">
        <FeaturesBar config={featuresBarConfig || undefined} />
      </FadeIn>
    ) : null,
    flash_deals:
      sectionEnabled("flash_deals") &&
      activeFlashSales &&
      activeFlashSales.length > 0 ? (
        <FadeIn key="flash_deals" delay={0.15} direction="up">
          <div className="bg-red-600 text-white py-3 sm:py-4 px-3 sm:px-4 text-center shadow-lg relative z-20">
            <Link href="/flash-deals" className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 text-xs sm:text-sm font-bold uppercase tracking-wider hover:scale-105 transition-transform">
              <Clock className="w-4 h-4 sm:w-5 sm:h-5 animate-pulse shrink-0" />
              <span>Flash Sale Live! Shop limited time deals before they're gone</span>
              <span className="bg-black/20 px-2.5 py-0.5 sm:px-3 sm:py-1 rounded text-[10px] sm:text-xs shrink-0">Shop Now</span>
            </Link>
          </div>
        </FadeIn>
      ) : null,
    category_highlight: sectionEnabled("category_highlight") ? (
      <FadeIn key="category_highlight" delay={0.2} direction="up">
        <CategoryHighlight
          categories={categories}
          curatedData={curatedCategoriesData ?? undefined}
        />
      </FadeIn>
    ) : null,
  };

  const mainBlocks: Record<string, ReactNode> = {
    explore_collections: sectionEnabled("explore_collections") ? (
      <FadeIn key="explore_collections">
        <ExploreCollections collections={collections} categories={categories} />
      </FadeIn>
    ) : null,
    featured_promo:
      sectionEnabled("featured_promo") && featuredPromoBanner ? (
        <FadeIn key="featured_promo" direction="left">
          <PromoBanner
            title={featuredPromoBanner.title}
            subtitle={featuredPromoBanner.subtitle}
            description={featuredPromoBanner.description}
            ctaText={featuredPromoBanner.ctaText}
            ctaLink={featuredPromoBanner.ctaLink}
            imageUrl={featuredPromoBanner.imageUrl}
          />
        </FadeIn>
      ) : null,
    trending_products: sectionEnabled("trending_products") ? (
      <FadeIn key="trending_products">
        <TrendingProducts products={trendingProducts.data || []} />
      </FadeIn>
    ) : null,
    why_choose_us: sectionEnabled("why_choose_us") ? (
      <FadeIn key="why_choose_us" direction="right">
        <WhyChooseUs data={whyChooseUsData || undefined} />
      </FadeIn>
    ) : null,
    featured_products: sectionEnabled("featured_products") ? (
        <FadeIn>
          <FeaturedProducts products={featuredProducts} />
        </FadeIn>
    ) : null,
    collection_sections: sectionEnabled("collection_sections") ? (
      <div key="collection_sections" className="space-y-10 md:space-y-14">
        {collectionSections.map(({ category, products }) => (
          <FadeIn key={category.id}>
            <BrandedCollection
              products={products}
              title={`${category.name} Collection`}
              subtitle={category.name}
              viewAllLink={`/categories/${category.slug}`}
            />
          </FadeIn>
        ))}
      </div>
    ) : null,
    campaigns:
      sectionEnabled("campaigns") && extraPromos.length > 0 ? (
        <FadeIn key="campaigns">
            <section>
              <div className="mb-6">
                <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-[#C9A86A]">
                  Campaigns
                </p>
                <h2 className="mt-1 font-serif text-2xl text-zinc-900 md:text-3xl">
                  Current Campaigns
                </h2>
              </div>
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                {extraPromos.map((promo) => (
                  <Link
                    key={promo.id}
                    href={promo.cta_url || "/products"}
                    className="group relative block overflow-hidden rounded-md shadow-sm"
                  >
                    <div className="relative aspect-[16/9] w-full">
                      <Image
                        src={promo.image_desktop}
                        alt={promo.title || "Campaign"}
                        fill
                        sizes="(max-width: 768px) 100vw, 50vw"
                        className="object-cover transition-transform duration-700 group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
                      <div className="absolute inset-x-0 bottom-0 p-5">
                        {promo.title && (
                          <h3 className="font-serif text-xl text-white md:text-2xl">
                            {promo.title}
                          </h3>
                        )}
                        {promo.description && (
                          <p className="mt-1 line-clamp-2 max-w-md text-sm text-white/85">
                            {promo.description}
                          </p>
                        )}
                        {promo.cta_text && (
                          <span className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-[#E6C687]">
                            {promo.cta_text} <ArrowRight className="h-3.5 w-3.5" />
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
        </FadeIn>
      ) : null,
    latest_blogs: sectionEnabled("latest_blogs") ? (
      <FadeIn key="latest_blogs">
        <LatestBlogs />
      </FadeIn>
    ) : null,
  };

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-[#FAFAFA]">
      {/* 1. Immersive Hero Banner (slides managed in CMS → Banners) */}
      <HomeHero slides={heroSlides} />

      {orderedKeys("top").map((k) => topBlocks[k])}

      <div className="space-y-10 py-6 md:space-y-16 md:py-12 lg:space-y-20 lg:py-16">
        {orderedKeys("main").map((k) => mainBlocks[k])}
      </div>
    </div>
  );
}
