import type { Metadata } from "next";

/**
 * Shared storefront SEO metadata builder.
 *
 * REG-68: this module was a one-line stub that ignored its input and
 * returned the literal title "Title" for every consumer — all 74
 * category pages rendered "<title>Title | Anchor Fashion</title>".
 * It now builds real metadata from the caller's values.
 *
 * Titles are used exactly as authored: callers pass the complete
 * "<Page> | Anchor Fashion" form, matching the codebase convention
 * (REG-69 — the root layout no longer appends a template suffix).
 */
export interface SeoMetadataInput {
  title: string;
  description?: string;
  url?: string;
  image?: string;
  keywords?: string[];
}

export const generateMetadata = async (
  props: SeoMetadataInput
): Promise<Metadata> => {
  const { title, description, url, image, keywords } = props || {
    title: "Anchor Fashion",
  };

  const metadata: Metadata = {
    title: title || "Anchor Fashion",
  };
  if (description) metadata.description = description;
  if (keywords && keywords.length > 0) metadata.keywords = keywords;
  metadata.openGraph = {
    title: title || "Anchor Fashion",
    ...(description ? { description } : {}),
    ...(url ? { url } : {}),
    ...(image ? { images: [{ url: image }] } : {}),
    type: "website",
  };

  return metadata;
};
