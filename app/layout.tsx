import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { jost, playfair, inter } from "@/lib/fonts";
import "./globals.css";
import { GlobalProviders } from "@/providers/GlobalProviders";
import { AnalyticsProviders } from "@/components/analytics/AnalyticsProviders";

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

import {
  getSeoSettings,
  getStoreInfo,
  getSocialLinks,
} from "@/lib/actions/settings.actions";

export async function generateMetadata(): Promise<Metadata> {
  const seo = await getSeoSettings();

  const titleDefault = seo.meta_title || "Anchor Fashion | Premium E-Commerce";
  const desc = seo.meta_description || "Enterprise e-commerce platform for Anchor Fashion.";
  const image = seo.social_image || "/og-image.jpg";
  const keywordsList = seo.keywords
    ? seo.keywords.split(",").map((k) => k.trim())
    : [
        "fashion",
        "clothing",
        "ecommerce",
        "premium apparel",
        "anchor fashion",
        "bangladesh",
      ];

  return {
    // REG-69: no title template. The codebase convention (200+ pages) is
    // that each page authors its COMPLETE title including the brand
    // suffix ("… | Anchor Fashion"); the old `%s | Anchor Fashion`
    // template appended the brand a second time on all of them
    // ("Home | Anchor Fashion Enterprise | Anchor Fashion", every
    // product page, …). Pages without metadata fall back to this
    // default unchanged.
    title: titleDefault,
    description: desc,
    metadataBase: new URL("https://anchorfashion.com"),
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "any" },
        { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
        { url: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
        { url: "/icon.png", type: "image/png", sizes: "512x512" },
      ],
      shortcut: "/favicon.ico",
      apple: [
        { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
      ],
    },
    keywords: keywordsList,
    authors: [{ name: "Anchor Fashion" }],
    creator: "Anchor Fashion",
    openGraph: {
      type: "website",
      locale: "en_US",
      url: "https://anchorfashion.com",
      title: titleDefault,
      description: desc,
      siteName: "Anchor Fashion",
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: titleDefault,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: titleDefault,
      description: desc,
      images: [image],
      creator: "@anchorfashion",
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-video-preview": -1,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    },
    alternates: {
      canonical: "https://anchorfashion.com",
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // REG-62: the JSON-LD below takes its contact phone and social links
  // from the same Admin settings (store_info / social_links) as every
  // other surface — it previously hardcoded a dummy phone number and
  // invented social URLs. Settings reads are cached; any failure falls
  // back to the canonical settings defaults.
  const [storeInfo, socialLinks] = await Promise.all([
    getStoreInfo().catch(() => null),
    getSocialLinks().catch(() => null),
  ]);
  const jsonLdPhone = storeInfo?.phone || "+880 1711-223344";
  const jsonLdSocials = [
    socialLinks?.facebook,
    socialLinks?.instagram,
    socialLinks?.twitter,
    socialLinks?.youtube,
    socialLinks?.tiktok,
  ].filter(
    (u): u is string => typeof u === "string" && u.startsWith("http")
  );

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Jost:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&display=swap" rel="stylesheet" />
      </head>
      <body
        className={`${jost.variable} ${playfair.variable} ${inter.variable} ${jost.className} min-h-screen overflow-x-hidden bg-background text-foreground antialiased`}
        suppressHydrationWarning
      >
        <GlobalProviders>{children}</GlobalProviders>
        {/* JSON-LD Structured Data: Organization & WebSite */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@graph": [
                {
                  "@type": "Organization",
                  "@id": "https://anchorfashion.com/#organization",
                  name: "Anchor Fashion",
                  url: "https://anchorfashion.com",
                  logo: {
                    "@type": "ImageObject",
                    url: "https://anchorfashion.com/icon.png",
                    width: 512,
                    height: 512,
                  },
                  sameAs: jsonLdSocials,
                  contactPoint: {
                    "@type": "ContactPoint",
                    telephone: jsonLdPhone,
                    contactType: "customer service",
                    areaServed: "BD",
                    availableLanguage: ["en", "bn"],
                  },
                },
                {
                  "@type": "WebSite",
                  "@id": "https://anchorfashion.com/#website",
                  url: "https://anchorfashion.com",
                  name: "Anchor Fashion",
                  description:
                    "Premium luxury fashion and modern apparel in Bangladesh.",
                  publisher: {
                    "@id": "https://anchorfashion.com/#organization",
                  },
                  potentialAction: {
                    "@type": "SearchAction",
                    target:
                      "https://anchorfashion.com/products?search={search_term_string}",
                    "query-input": "required name=search_term_string",
                  },
                },
              ],
            }),
          }}
        />
        <Suspense fallback={null}>
          <AnalyticsProviders />
        </Suspense>
      </body>
    </html>
  );
}
