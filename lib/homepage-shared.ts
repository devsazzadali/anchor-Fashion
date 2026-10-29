/**
 * Homepage section registry + defaults (shared by server actions, the
 * storefront page, and the admin Homepage Manager client). Kept outside
 * the "use server" actions module because server-action files may only
 * export async functions to client importers.
 */

export interface HomepageSectionSetting {
  key: string;
  isEnabled: boolean;
}

export interface HomepageLayout {
  sections: HomepageSectionSetting[];
}

export interface FeatureBarItem {
  icon: string;
  title: string;
  description: string;
}

export interface FeaturesBarConfig {
  isEnabled: boolean;
  items: FeatureBarItem[];
}

/** Canonical section registry — order here is the default render order. */
export const HOMEPAGE_SECTIONS: {
  key: string;
  label: string;
  group: "top" | "main";
  description: string;
}[] = [
  { key: "features_bar", label: "Features Bar", group: "top", description: "Service guarantees strip under the hero (editable in the Homepage Manager)." },
  { key: "flash_deals", label: "Flash Deals Strip", group: "top", description: "Red flash-sale banner (also needs an active flash sale to show)." },
  { key: "category_highlight", label: "Curated Showcase (The Style Edit)", group: "top", description: "Editorial category masonry — content managed in CMS → Curated Categories." },
  { key: "explore_collections", label: "Explore Collections", group: "main", description: "Collections grid from the catalog collections." },
  { key: "featured_promo", label: "Featured Promo Banner", group: "main", description: "The featured CMS campaign banner." },
  { key: "trending_products", label: "Trending Products", group: "main", description: "Top-rated products rail." },
  { key: "why_choose_us", label: "Why Choose Us", group: "main", description: "Brand ethos section — content managed in CMS → Why Choose Us." },
  { key: "featured_products", label: "Featured Products (New Arrivals)", group: "main", description: "Products flagged Featured in the catalog." },
  { key: "collection_sections", label: "Category Collection Sections", group: "main", description: "One product section per top-level category, in category display order." },
  { key: "campaigns", label: "Campaigns Grid", group: "main", description: "Remaining active CMS campaign banners." },
  { key: "latest_blogs", label: "Latest from the Blog", group: "main", description: "Newest published blog posts." },
];

export const DEFAULT_HOMEPAGE_LAYOUT: HomepageLayout = {
  sections: HOMEPAGE_SECTIONS.map((s) => ({ key: s.key, isEnabled: true })),
};

export const DEFAULT_FEATURES_BAR: FeaturesBarConfig = {
  isEnabled: true,
  items: [
    { icon: "Truck", title: "Free Delivery", description: "Orders over ৳999" },
    { icon: "RotateCcw", title: "Easy Returns", description: "7-day free returns" },
    { icon: "Award", title: "Premium Quality", description: "Finest materials only" },
    { icon: "ShieldCheck", title: "Secure Checkout", description: "100% safe & encrypted" },
  ],
};
