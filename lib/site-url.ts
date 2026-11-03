/**
 * Canonical public site URL — single source of truth for every SEO
 * surface (metadataBase, Open Graph, canonical links, JSON-LD,
 * sitemap.xml, robots.txt).
 *
 * FIX2 (R30 OBS-6): sitemap.ts and robots.ts already resolved the base
 * as `NEXT_PUBLIC_SITE_URL` (when set and not localhost) falling back
 * to https://www.anchorfashion.com.bd, while app/layout.tsx and the
 * shop pages hardcoded https://anchorfashion.com — so crawlers were
 * told two different canonical domains (the sitemap listed 273 URLs
 * on .com.bd while every page's canonical pointed at .com, a domain
 * that is parked and is NOT this store). The business domain is
 * anchorfashion.com.bd (support mailbox is @anchorfashion.com.bd and
 * the env-driven sitemap/robots already used it), so it is canonical
 * everywhere now. Resolution semantics are byte-identical to the
 * pre-existing sitemap/robots expression.
 */
export function getSiteUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (envUrl && !envUrl.includes("localhost")) {
    return envUrl.replace(/\/$/, "");
  }
  return "https://www.anchorfashion.com.bd";
}
