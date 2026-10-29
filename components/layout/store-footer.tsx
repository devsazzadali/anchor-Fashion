import Link from "next/link";
import { AnchorFashionLogo } from "@/components/shared/logo";
import {
  Facebook,
  Instagram,
  Youtube,
  Mail,
  Phone,
  MapPin,
} from "lucide-react";
import { getStoreInfo, getSocialLinks } from "@/lib/actions/settings.actions";
import { CatalogRepository } from "@/repositories/catalog.repository";
import { StoreFooterNewsletter } from "@/components/layout/StoreFooterNewsletter";
import { jost } from "@/lib/fonts";


const footerLinks = {
  help: [
    { label: "Size Guide", href: "/support/size-guide" },
    { label: "Shipping & Returns", href: "/support/shipping" },
    { label: "Track My Order", href: "/support/track-order" },
    { label: "FAQ", href: "/support/faq" },
    { label: "Contact Us", href: "/contact" },
  ],
  legal: [
    { label: "About Us", href: "/about" },
    { label: "Style Blog & Journal", href: "/blog" },
    { label: "Privacy Policy", href: "/privacy" },
    { label: "Terms of Service", href: "/terms" },
    { label: "Cookie Policy", href: "/cookies" },
  ],
};

const paymentMethods = [
  { name: "Bkash", bg: "#E2136E", text: "white", abbr: "bKash" },
  { name: "Nagad", bg: "#F6891F", text: "white", abbr: "Nagad" },
  { name: "Rocket", bg: "#8C3494", text: "white", abbr: "Rocket" },
  { name: "Visa", bg: "#1A1F71", text: "white", abbr: "VISA" },
  { name: "MasterCard", bg: "#EB001B", text: "white", abbr: "MC" },
  { name: "SSLCOMMERZ", bg: "#128C7E", text: "white", abbr: "SSL" },
];

export async function StoreFooter() {
  const [storeInfo, socialLinks, allCategories] = await Promise.all([
    getStoreInfo(),
    getSocialLinks(),
    CatalogRepository.getCategories().catch(() => [] as any[]),
  ]);

  // Phase 9 (no-hardcode rule): the Shop column is built from the
  // admin-managed category tree in the database — it previously pointed at
  // hardcoded /categories/men|women|accessories|sale slugs that do not
  // exist. Static "All Products / New Arrivals" utility links stay.
  const shopLinks = [
    ...(allCategories as any[])
      .filter((c) => !c.parent_id && c.is_active !== false)
      .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
      .slice(0, 6)
      .map((c) => ({ label: c.name, href: `/categories/${c.slug}` })),
    { label: "New Arrivals", href: "/products?sort=newest" },
    { label: "All Products", href: "/products" },
  ];

  return (
    <footer className={`${jost.className} bg-[#FAFAFA] text-gray-900 border-t border-gray-200`}>
      {/* Main Links Section */}
      <div className="container mx-auto px-4 py-14 md:px-6">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-2 lg:grid-cols-5 lg:gap-6">
          {/* Brand Column */}
          <div className="space-y-6 lg:col-span-2">
            {/* Logo */}
            <div className="w-48 opacity-90">
              <AnchorFashionLogo />
            </div>
            <p className="max-w-xs text-sm font-light leading-relaxed text-gray-600">
              {storeInfo.store_description ||
                "Crafting premium fashion experiences for the modern, style-conscious individual."}
            </p>
            {/* Social Links */}
            <div className="flex items-center gap-3 pt-1">
              {[
                {
                  icon: Facebook,
                  href: socialLinks?.facebook || "#",
                  label: "Facebook",
                },
                {
                  icon: Instagram,
                  href: socialLinks?.instagram || "#",
                  label: "Instagram",
                },
                {
                  icon: Youtube,
                  href: socialLinks?.youtube || "#",
                  label: "YouTube",
                },
              ].map(({ icon: Icon, href, label }) => (
                <Link
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="flex h-9 w-9 items-center justify-center border border-gray-300 text-gray-500 transition-all duration-300 hover:border-[#C9A86A] hover:text-[#C9A86A]"
                >
                  <Icon className="h-4 w-4" />
                </Link>
              ))}
            </div>
            {/* Contact */}
            <div className="space-y-2.5 pt-1">
              {storeInfo.phone && (
                <div className="flex items-center gap-2.5 text-sm text-gray-600">
                  <Phone
                    className="h-4 w-4 flex-shrink-0 text-[#C9A86A]"
                    strokeWidth={1.5}
                  />
                  <span>{storeInfo.phone}</span>
                </div>
              )}
              {storeInfo.email && (
                <div className="flex items-center gap-2.5 text-sm text-gray-600">
                  <Mail
                    className="h-4 w-4 flex-shrink-0 text-[#C9A86A]"
                    strokeWidth={1.5}
                  />
                  <span>{storeInfo.email}</span>
                </div>
              )}
              {storeInfo.address && (
                <div className="flex items-start gap-2.5 text-sm text-gray-600">
                  <MapPin
                    className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#C9A86A]"
                    strokeWidth={1.5}
                  />
                  <span>{storeInfo.address}</span>
                </div>
              )}
            </div>
            {/* Newsletter signup (Phase 9: the form component + subscribe
                action existed but were mounted nowhere — the public could
                never subscribe). */}
            <div className="space-y-3 pt-2">
              <h3 className="text-xs font-bold uppercase tracking-[0.25em] text-[#C9A86A]">
                Stay in the loop
              </h3>
              <p className="max-w-xs text-sm font-light leading-relaxed text-gray-600">
                New drops, festive edits and member-only offers — straight to
                your inbox.
              </p>
              <StoreFooterNewsletter />
            </div>
          </div>

          {/* Shop Column */}
          <div className="space-y-5">
            <h3 className="text-xs font-bold uppercase tracking-[0.25em] text-[#C9A86A]">
              Shop
            </h3>
            <ul className="space-y-3">
              {shopLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm font-light text-gray-600 transition-colors hover:text-[#C9A86A]"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Help Column */}
          <div className="space-y-5">
            <h3 className="text-xs font-bold uppercase tracking-[0.25em] text-[#C9A86A]">
              Help
            </h3>
            <ul className="space-y-3">
              {footerLinks.help.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm font-light text-gray-600 transition-colors hover:text-[#C9A86A]"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal Column */}
          <div className="space-y-5">
            <h3 className="text-xs font-bold uppercase tracking-[0.25em] text-[#C9A86A]">
              Company
            </h3>
            <ul className="space-y-3">
              {footerLinks.legal.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm font-light text-gray-600 transition-colors hover:text-[#C9A86A]"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="border-t border-gray-200">
        <div className="container mx-auto flex flex-col items-center justify-between gap-4 px-4 py-6 md:flex-row md:px-6">
          <p className="text-xs font-light tracking-wide text-gray-500">
            © {new Date().getFullYear()}{" "}
            {storeInfo.store_name || "Anchor Fashion"}. All rights reserved.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-[10px] uppercase tracking-widest text-gray-500">
              We accept
            </span>
            {paymentMethods.map((method) => (
              <span
                key={method.name}
                className="inline-flex items-center justify-center rounded px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide"
                style={{ backgroundColor: method.bg, color: method.text }}
                title={method.name}
              >
                {method.abbr}
              </span>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
