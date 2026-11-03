import { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  // FIX2 (OBS-6): canonical base via the shared helper (same value this
  // file previously computed inline — see lib/site-url.ts).
  const baseUrl = getSiteUrl();

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/admin/",
        "/auth/",
        "/account/",
        "/dashboard/",
        "/manager/",
        "/inventory/",
        "/cms/",
        "/crm/",
      ],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
