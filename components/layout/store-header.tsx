"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search,
  ShoppingCart,
  Heart,
  User,
  Menu,
  Phone,
} from "lucide-react";
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AnchorFashionLogo } from "@/components/shared/logo";
import { PremiumMobileMenu } from "@/components/layout/mobile-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ADMIN_ROLES, MANAGER_ROLES } from "@/lib/constants/auth";
import { useCartStore } from "@/stores/use-cart-store";
import { useWishlistStore } from "@/stores/use-wishlist-store";
import { useSessionContext } from "@/providers/session-provider";
import { cn } from "@/lib/utils";

interface Category {
  id: string;
  name: string;
  slug: string;
  parent_id?: string | null;
  image_url?: string | null;
  display_order?: number;
  is_active?: boolean;
}

interface MegaMenuCard {
  tag?: string;
  title: string;
  subtitle?: string;
  src: string;
  alt: string;
  href: string;
  ctaText?: string;
}

interface MegaMenuColumn {
  title: string;
  links: { label: string; href: string }[];
}

interface NavLinkItem {
  label: string;
  href: string;
  megaMenu?: {
    leftCard?: MegaMenuCard;
    columns: MegaMenuColumn[];
    rightCards?: MegaMenuCard[];
  };
}

function NavItem({
  link,
  setActiveMenu,
}: {
  link: NavLinkItem;
  setActiveMenu: (label: string, isHovered: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setOpen(true);
  };

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => {
      setOpen(false);
    }, 150);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!link.megaMenu) return;
    setActiveMenu(link.label, open);
  }, [open, link.label, link.megaMenu, setActiveMenu]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div
      ref={ref}
      className="static"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Link
        href={link.href}
        className={cn(
          "relative flex items-center py-4 text-[13px] font-bold uppercase tracking-[0.12em] transition-colors duration-200",
          open ? "text-[#C9A86A]" : "text-gray-700 hover:text-[#C9A86A]"
        )}
      >
        {link.label}
        {link.megaMenu && (
          <span
            className={cn(
              "absolute bottom-0 left-0 right-0 h-[2.5px] bg-[#C9A86A] transition-all duration-300 ease-out rounded-full",
              open ? "w-full opacity-100" : "w-0 opacity-0"
            )}
          />
        )}
      </Link>

      {link.megaMenu && (
        <div
          className={cn(
            "absolute left-0 right-0 top-full w-full bg-white shadow-[0_25px_60px_-15px_rgba(0,0,0,0.18)] transition-all duration-300 ease-out z-50 border-t border-gray-100",
            open
              ? "translate-y-0 opacity-100 visible pointer-events-auto"
              : "-translate-y-2 opacity-0 invisible pointer-events-none"
          )}
        >
          <div className="mx-auto flex max-w-7xl items-start justify-between gap-8 px-6 py-8 lg:px-8">
            {/* 1. Left Lifestyle Editorial Card */}
            {link.megaMenu.leftCard && (
              <Link
                href={link.megaMenu.leftCard.href}
                onClick={() => setOpen(false)}
                className="group/left relative block w-[190px] xl:w-[210px] shrink-0 aspect-[3/4] overflow-hidden rounded-md border border-gray-200/80 bg-gray-100 shadow-sm transition-all duration-300 hover:shadow-md"
              >
                <img
                  src={link.megaMenu.leftCard.src}
                  alt={link.megaMenu.leftCard.alt}
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out group-hover/left:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent transition-opacity group-hover/left:from-black/90" />
                <div className="absolute inset-x-0 bottom-0 flex flex-col items-start p-4">
                  {link.megaMenu.leftCard.tag && (
                    <span className="mb-1.5 inline-block rounded bg-[#C9A86A] px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-black">
                      {link.megaMenu.leftCard.tag}
                    </span>
                  )}
                  <p className="text-xs font-bold uppercase tracking-wider text-white leading-tight">
                    {link.megaMenu.leftCard.title}
                  </p>
                  {link.megaMenu.leftCard.subtitle && (
                    <p className="mt-1 text-[11px] font-medium text-gray-300 line-clamp-1">
                      {link.megaMenu.leftCard.subtitle}
                    </p>
                  )}
                  <span className="mt-2.5 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[#E6C687] group-hover/left:translate-x-1 transition-transform">
                    {link.megaMenu.leftCard.ctaText || "Shop Now"} →
                  </span>
                </div>
              </Link>
            )}

            {/* 2. Center Category Columns */}
            <div
              className={cn(
                "flex-1 grid gap-6 xl:gap-8 px-2",
                link.megaMenu.columns.length <= 2
                  ? "grid-cols-2"
                  : link.megaMenu.columns.length === 3
                    ? "grid-cols-3"
                    : "grid-cols-2 md:grid-cols-3 xl:grid-cols-4"
              )}
            >
              {link.megaMenu.columns.map((col, idx) => (
                <div key={idx} className="flex flex-col">
                  {col.title && (
                    <h3 className="mb-3.5 pb-2 text-[12px] font-bold uppercase tracking-[0.14em] text-gray-900 border-b border-gray-100 flex items-center justify-between">
                      <span>{col.title}</span>
                    </h3>
                  )}
                  <div className="flex flex-col gap-2.5">
                    {col.links.map((subItem) => (
                      <Link
                        key={subItem.href}
                        href={subItem.href}
                        className="group/link flex items-center text-[12px] font-medium uppercase tracking-wide text-gray-600 transition-all duration-200 hover:text-[#C9A86A] hover:translate-x-1"
                        onClick={() => setOpen(false)}
                      >
                        <span className="transition-colors">{subItem.label}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* 3. Right Dual Campaign Lifestyle Cards */}
            {link.megaMenu.rightCards && link.megaMenu.rightCards.length > 0 && (
              <div className="w-[300px] xl:w-[340px] shrink-0 grid grid-cols-2 gap-3">
                {link.megaMenu.rightCards.map((card, idx) => (
                  <Link
                    key={idx}
                    href={card.href}
                    onClick={() => setOpen(false)}
                    className="group/card relative block aspect-[3/4] overflow-hidden rounded-md border border-gray-200/80 bg-gray-100 shadow-sm transition-all duration-300 hover:shadow-md"
                  >
                    <img
                      src={card.src}
                      alt={card.alt}
                      loading="lazy"
                      decoding="async"
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out group-hover/card:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent transition-opacity group-hover/card:from-black/90" />
                    <div className="absolute inset-x-0 bottom-0 flex flex-col items-start p-3">
                      {card.tag && (
                        <span className="mb-1 inline-block text-[9px] font-bold uppercase tracking-widest text-[#E6C687]">
                          {card.tag}
                        </span>
                      )}
                      <p className="text-[11px] font-bold uppercase tracking-wide text-white leading-tight line-clamp-2">
                        {card.title}
                      </p>
                      <span className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-white/90 group-hover/card:text-[#E6C687] group-hover/card:translate-x-1 transition-all">
                        {card.ctaText || "Explore"} →
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function StoreHeader({
  dbCategories = [],
  contactPhone,
  contactEmail,
  announcementBar,
  user: propUser,
}: {
  dbCategories?: Category[];
  contactPhone?: string;
  contactEmail?: string;
  announcementBar?: string;
  user?: any;
}) {
  const router = useRouter();
  const { user: contextUser } = useSessionContext();
  const user = propUser || contextUser;
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCategory, setSearchCategory] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isScrollingDown, setIsScrollingDown] = useState(false);
  const [hoveredMenu, setHoveredMenu] = useState<string | null>(null);
  const isMenuHovered = hoveredMenu !== null;
  const lastScrollY = useRef(0);

  const handleMenuHover = useCallback((label: string, isHovered: boolean) => {
    setHoveredMenu((prev) => {
      if (isHovered) return label;
      if (prev === label) return null;
      return prev;
    });
  }, []);

  const { cart, fetchCart, setSheetOpen } = useCartStore();
  const { wishlist, fetchWishlist } = useWishlistStore();
  const cartItemCount =
    cart?.items?.reduce((sum, item) => sum + item.quantity, 0) || 0;
  const wishlistItemCount = wishlist?.items?.length || 0;

  useEffect(() => {
    fetchCart();
    fetchWishlist();
  }, [fetchCart, fetchWishlist]);

  useEffect(() => {
    setMounted(true);
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      if (currentScrollY > lastScrollY.current && currentScrollY > 120) {
        setIsScrollingDown(true);
      } else {
        setIsScrollingDown(false);
      }
      lastScrollY.current = currentScrollY;
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const role =
    user?.user_metadata?.role || user?.app_metadata?.role || "CUSTOMER";
  const isAdmin = ADMIN_ROLES.includes(role);
  const isManager = MANAGER_ROLES.includes(role);

  const accountHref = !user
    ? "/auth/login"
    : isAdmin
      ? "/admin"
      : isManager
        ? "/manager"
        : "/account/profile";

  const userInitials = (
    user?.user_metadata?.full_name ||
    user?.email ||
    "U"
  )
    .slice(0, 2)
    .toUpperCase();

  // Maintain categories state with automatic fallback for pages that don't pass dbCategories
  const [categories, setCategories] = useState<Category[]>(dbCategories);

  useEffect(() => {
    if (dbCategories && dbCategories.length > 0) {
      setCategories(dbCategories);
    } else {
      fetch("/api/categories")
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => {
          if (Array.isArray(data) && data.length > 0) {
            setCategories(data);
          }
        })
        .catch(() => {});
    }
  }, [dbCategories]);

  // Dynamically build navLinks from categories configured in Admin Dashboard
  const navLinks: NavLinkItem[] = useMemo(() => {
    // Filter root categories that are active, ordered by display_order set in Admin
    const topLevelCategories = categories
      .filter(
        (c) =>
          !c.parent_id &&
          c.is_active !== false &&
          !c.slug.toLowerCase().includes("qa") &&
          !c.name.toLowerCase().startsWith("qa")
      )
      .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));

    // Fallback if no categories are configured yet: utility links only.
    // (Phase 9: no fabricated category names — the nav is DB-driven.)
    if (topLevelCategories.length === 0) {
      return [
        { label: "ALL PRODUCTS", href: "/products" },
        { label: "NEW ARRIVALS", href: "/products?sort=newest" },
      ];
    }

    const links: NavLinkItem[] = [];

    topLevelCategories.forEach((topCat) => {
      const children = categories.filter(
        (c) => c.parent_id === topCat.id && c.is_active !== false
      );

      // Build category columns
      const columns: MegaMenuColumn[] = [];

      // Check for 3rd level categories first
      let hasSubChildren = false;
      const directLeaves: Category[] = [];

      children.forEach((child) => {
        const grandChildren = categories.filter(
          (c) => c.parent_id === child.id && c.is_active !== false
        );
        if (grandChildren.length > 0) {
          hasSubChildren = true;
          columns.push({
            title: child.name.toUpperCase(),
            links: [
              { label: `All ${child.name}`, href: `/categories/${child.slug}` },
              ...grandChildren.map((gc) => ({
                label: gc.name,
                href: `/categories/${gc.slug}`,
              })),
            ],
          });
        } else {
          directLeaves.push(child);
        }
      });

      if (hasSubChildren && directLeaves.length > 0) {
        columns.unshift({
          title: `ALL ${topCat.name.toUpperCase()}`,
          links: directLeaves.map((c) => ({
            label: c.name,
            href: `/categories/${c.slug}`,
          })),
        });
      } else if (!hasSubChildren && children.length > 0) {
        // Main categories with child types
        columns.push({
          title: `ALL ${topCat.name.toUpperCase()}`,
          links: [
            { label: `View All ${topCat.name}`, href: `/categories/${topCat.slug}` },
            ...children.map((c) => ({
              label: c.name,
              href: `/categories/${c.slug}`,
            })),
          ],
        });
      } else if (children.length === 0) {
        columns.push({
          title: `EXPLORE ${topCat.name.toUpperCase()}`,
          links: [
            { label: `All ${topCat.name}`, href: `/categories/${topCat.slug}` },
            { label: "New In", href: `/categories/${topCat.slug}?sort=newest` },
            { label: "Best Sellers", href: `/categories/${topCat.slug}?sort=bestselling` },
          ],
        });
      }

      // Phase 9: mega-menu cards are derived ONLY from the category tree in
      // the database (admin-managed). The previous hardcoded per-slug
      // "editorial" config (Unsplash stock photos + links to categories that
      // may not exist) was removed — no hardcode rule.
      const leftCard: MegaMenuCard | undefined = topCat.image_url
        ? {
            tag: "FEATURED",
            title: topCat.name,
            subtitle: "Explore the collection",
            src: topCat.image_url,
            alt: topCat.name,
            href: `/categories/${topCat.slug}`,
            ctaText: "Shop Collection",
          }
        : undefined;

      // Right cards spotlight up to two child categories that have their own
      // admin-uploaded image.
      const rightCards: MegaMenuCard[] = children
        .filter((c) => !!c.image_url)
        .slice(0, 2)
        .map((c) => ({
          tag: "EXPLORE",
          title: c.name,
          src: c.image_url as string,
          alt: c.name,
          href: `/categories/${c.slug}`,
          ctaText: "Explore",
        }));

      links.push({
        label: topCat.name.toUpperCase(),
        href: `/categories/${topCat.slug}`,
        megaMenu: {
          leftCard,
          columns,
          rightCards,
        },
      });
    });

    return links;
  }, [categories]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const query = searchQuery.trim();
    if (query) {
      let url = `/search?q=${encodeURIComponent(query)}`;
      if (searchCategory && searchCategory !== "all")
        url += `&category=${searchCategory}`;
      router.push(url);
    }
  };

  return (
    <>
      {/* Announcement Bar */}
      <div className="w-full bg-[#1e2029] px-3 py-2 text-center text-[10px] sm:text-xs font-semibold tracking-widest text-white sm:py-2.5 uppercase">
        <div className="mx-auto max-w-7xl truncate">
          {announcementBar ?? "Step Into The Festive Season With Anchor Fashion"}
        </div>
      </div>

      {/* Sticky Main Header */}
      <header
        className={cn(
          "sticky top-0 z-40 w-full bg-white transition-all duration-300",
          isScrollingDown ? "-translate-y-full" : "translate-y-0",
          isMenuHovered ? "border-b-transparent shadow-none" : "border-b border-gray-100 shadow-sm"
        )}
      >
        {/* Top Row: Logo, Search, Action Icons */}
        <div className="mx-auto flex h-[88px] max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          {/* Mobile Menu Button */}
          <div className="flex items-center lg:hidden">
            {mounted ? (
              <PremiumMobileMenu
                open={mobileMenuOpen}
                onOpenChange={setMobileMenuOpen}
                categories={categories}
                navLinks={navLinks}
                user={user}
                cartItemCount={cartItemCount}
                wishlistItemCount={wishlistItemCount}
                contactPhone={contactPhone}
                announcementBar={announcementBar}
                triggerButton={
                  <button
                    type="button"
                    aria-label="Open navigation menu"
                    className="inline-flex items-center justify-center rounded-lg p-2 text-gray-800 transition-colors hover:bg-gray-100 hover:text-black focus:outline-none cursor-pointer"
                  >
                    <Menu className="h-6 w-6" />
                  </button>
                }
              />
            ) : (
              <div className="inline-flex items-center justify-center p-2 text-gray-700">
                <Menu className="h-6 w-6" />
              </div>
            )}
          </div>

          {/* Logo */}
          <div className="flex items-center justify-center lg:justify-start">
            <AnchorFashionLogo className="w-[120px] sm:w-[150px] lg:w-[170px]" />
          </div>

          {/* Search Bar - Desktop Only */}
          <div className="hidden lg:flex flex-1 items-center justify-center px-8 xl:px-12">
            <form
              onSubmit={handleSearchSubmit}
              className="flex w-full max-w-2xl items-center rounded-full bg-[#f8f9fa] border border-gray-200 px-5 py-2.5 transition-all focus-within:ring-1 focus-within:ring-gray-300 focus-within:border-gray-300 shadow-sm hover:shadow-md"
            >
              <input
                type="text"
                placeholder="Search"
                aria-label="Search catalog"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-400 outline-none"
              />
              <div className="mx-3 h-5 w-px bg-gray-200" />
              <Select
                value={searchCategory || "all"}
                onValueChange={(val) => setSearchCategory(val === "all" ? "" : (val || ""))}
                items={[
                  { value: "all", label: "All Categories" },
                  ...categories
                    .filter(
                      (c) =>
                        !c.parent_id &&
                        c.is_active !== false &&
                        !c.slug.toLowerCase().includes("qa") &&
                        !c.name.toLowerCase().startsWith("qa")
                    )
                    .map((c) => ({ value: c.slug, label: c.name })),
                ]}
              >
                <SelectTrigger className="w-[140px] border-0 bg-transparent shadow-none focus:ring-0 focus:ring-offset-0 text-sm font-medium text-gray-600 hover:text-gray-900 p-0 h-auto justify-between gap-1">
                  <SelectValue placeholder="Categories" />
                </SelectTrigger>
                <SelectContent className="rounded-xl shadow-lg border-gray-100">
                  <SelectItem value="all" className="cursor-pointer font-medium text-gray-600 focus:bg-gray-50 focus:text-gray-900">
                    All Categories
                  </SelectItem>
                  {categories
                    .filter(
                      (c) =>
                        !c.parent_id &&
                        c.is_active !== false &&
                        !c.slug.toLowerCase().includes("qa") &&
                        !c.name.toLowerCase().startsWith("qa")
                    )
                    .map((c) => (
                      <SelectItem key={c.id} value={c.slug} className="cursor-pointer text-gray-600 focus:bg-gray-50 focus:text-gray-900">
                        {c.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <button type="submit" aria-label="Submit search" className="ml-2 pl-2 cursor-pointer">
                <Search className="h-5 w-5 text-gray-500 hover:text-gray-900 transition-colors" />
              </button>
            </form>
          </div>

          {/* Right Action Icons */}
          <div className="flex items-center gap-4 sm:gap-6 lg:gap-8">
            {/* Call Us - Desktop Only */}
            {contactPhone && (
              <div className="hidden xl:flex items-center gap-3 group cursor-pointer">
                <div className="flex items-center justify-center w-9 h-9 rounded-full bg-[#f8f9fa] group-hover:bg-gray-200 transition-colors">
                  <Phone className="h-4 w-4 text-gray-700" strokeWidth={1.5} />
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-medium text-gray-500 uppercase tracking-widest leading-none mb-1">
                    Call Us Now
                  </span>
                  <span className="text-sm font-bold text-gray-900 leading-none tracking-wide">
                    {contactPhone}
                  </span>
                </div>
              </div>
            )}

            {/* Account */}
            <Link
              href={accountHref}
              aria-label={user ? "My Account" : "Sign In"}
              className="hidden sm:block text-gray-700 hover:text-[#C9A86A] transition-colors"
            >
              {user ? (
                <Avatar className="h-7 w-7">
                  <AvatarImage src={user.user_metadata?.avatar_url} />
                  <AvatarFallback className="bg-gray-900 text-[10px] font-bold text-white">
                    {userInitials}
                  </AvatarFallback>
                </Avatar>
              ) : (
                <User className="h-[22px] w-[22px]" strokeWidth={1.5} />
              )}
            </Link>

            {/* Wishlist */}
            <Link
              href="/account/wishlist"
              aria-label="Wishlist"
              className="relative text-gray-700 hover:text-[#C9A86A] transition-colors flex items-center gap-1.5"
            >
              <Heart className="h-[22px] w-[22px]" strokeWidth={1.5} />
              <span className="text-sm font-semibold hidden sm:inline-block tracking-wide">
                {mounted ? wishlistItemCount : 0}
              </span>
            </Link>

            {/* Cart */}
            <button
              onClick={() => setSheetOpen(true)}
              aria-label="Shopping Cart"
              className="relative text-gray-700 hover:text-[#C9A86A] transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <ShoppingCart className="h-[22px] w-[22px]" strokeWidth={1.5} />
              <span className="text-sm font-semibold hidden sm:inline-block tracking-wide">
                {mounted ? cartItemCount : 0}
              </span>
              {mounted && cartItemCount > 0 && (
                <span className="absolute -top-1.5 -right-2 sm:hidden flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-black px-1 text-[9px] font-bold text-white">
                  {cartItemCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Bottom Row: Desktop Navigation (Sailor Clothing Mega Menu Style) */}
        <div className="hidden lg:block border-t border-gray-100 relative">
          <nav className="mx-auto flex max-w-7xl items-center justify-center gap-8 xl:gap-10">
            {navLinks.map((link) => (
              <NavItem
                key={link.label}
                link={link}
                setActiveMenu={handleMenuHover}
              />
            ))}
          </nav>
        </div>
      </header>

      {/* Dimmed Page Backdrop when Mega Menu is Open */}
      <div
        aria-hidden="true"
        className={cn(
          "fixed inset-0 bg-black/25 backdrop-blur-[1.5px] z-30 transition-opacity duration-300 pointer-events-none",
          isMenuHovered ? "opacity-100" : "opacity-0"
        )}
      />
    </>
  );
}
