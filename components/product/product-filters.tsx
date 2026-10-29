"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { X, Check, Loader2, RotateCcw } from "lucide-react";

interface Category {
  id: string;
  name: string;
  slug: string;
}

interface Brand {
  id: string;
  name: string;
  slug: string;
}

interface ProductFiltersProps {
  categories: Category[];
  brands: Brand[];
  /** Distinct size facet values from live variant data. */
  sizes?: string[];
  /** Distinct colour facet values from live variant data. */
  colors?: string[];
  basePath?: string;
  onClose?: () => void;
  productCount?: number;
}

const PRICE_PRESETS = [
  { label: "Under ৳1,000", min: "0", max: "1000" },
  { label: "৳1,000 – ৳2,500", min: "1000", max: "2500" },
  { label: "৳2,500 – ৳5,000", min: "2500", max: "5000" },
  { label: "Over ৳5,000", min: "5000", max: "" },
];

export function ProductFilters({
  categories,
  brands,
  sizes = [],
  colors = [],
  basePath,
  onClose,
  productCount,
}: ProductFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const currentCategory = searchParams.get("category");
  const currentBrand = searchParams.get("brand");
  const currentMinPrice = searchParams.get("minPrice");
  const currentMaxPrice = searchParams.get("maxPrice");
  const currentSearch = searchParams.get("q");
  const parseFacetParam = (v: string | null): string[] =>
    v
      ? v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  const currentSizes = parseFacetParam(searchParams.get("size"));
  const currentColors = parseFacetParam(searchParams.get("color"));

  const [customMin, setCustomMin] = useState(currentMinPrice || "");
  const [customMax, setCustomMax] = useState(currentMaxPrice || "");

  // Update query params
  const updateQuery = useCallback(
    (updates: Record<string, string | null>) => {
      const p = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([key, val]) => {
        if (val === null || val === "") {
          p.delete(key);
        } else {
          p.set(key, val);
        }
      });
      p.delete("page"); // Reset to page 1 on filter change
      const targetPath = basePath || "/products";
      startTransition(() => router.push(`${targetPath}?${p.toString()}`));
    },
    [router, searchParams, basePath]
  );

  const toggleCategory = (slug: string) => {
    updateQuery({ category: currentCategory === slug ? null : slug });
  };

  const toggleBrand = (slug: string) => {
    updateQuery({ brand: currentBrand === slug ? null : slug });
  };

  const toggleSize = (size: string) => {
    const next = currentSizes.includes(size)
      ? currentSizes.filter((s) => s !== size)
      : [...currentSizes, size];
    updateQuery({ size: next.length ? next.join(",") : null });
  };

  const toggleColor = (color: string) => {
    const next = currentColors.includes(color)
      ? currentColors.filter((c) => c !== color)
      : [...currentColors, color];
    updateQuery({ color: next.length ? next.join(",") : null });
  };

  const applyPricePreset = (min: string, max: string) => {
    if (
      currentMinPrice === min &&
      (currentMaxPrice === max || (!currentMaxPrice && !max))
    ) {
      updateQuery({ minPrice: null, maxPrice: null });
    } else {
      updateQuery({ minPrice: min || null, maxPrice: max || null });
    }
  };

  const handleCustomPriceSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateQuery({
      minPrice: customMin ? customMin : null,
      maxPrice: customMax ? customMax : null,
    });
  };

  const clearAllFilters = () => {
    startTransition(() => router.push("/products"));
  };

  const hasActiveFilters = Boolean(
    currentCategory ||
      currentBrand ||
      currentMinPrice ||
      currentMaxPrice ||
      currentSearch ||
      currentSizes.length ||
      currentColors.length
  );

  const currentCategoryObj = categories.find((c) => c.slug === currentCategory);
  const currentBrandObj = brands.find((b) => b.slug === currentBrand);

  return (
    <div className="flex flex-col space-y-5">
      {/* Header row */}
      <div className="flex items-center justify-between border-b border-gray-100 pb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-900">
            Filters
          </h3>
          {isPending && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#C9A86A]" />
          )}
        </div>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearAllFilters}
            disabled={isPending}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#C9A86A] transition-colors hover:text-black disabled:opacity-50"
          >
            <RotateCcw className="h-3 w-3" />
            Reset all
          </button>
        )}
      </div>

      {/* Active Filter Badges */}
      {hasActiveFilters && (
        <div className="flex flex-wrap gap-1.5 pb-2 border-b border-gray-100">
          {currentSearch && (
            <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-900">
              <span>Search: &ldquo;{currentSearch}&rdquo;</span>
              <button
                type="button"
                onClick={() => updateQuery({ q: null })}
                disabled={isPending}
                className="hover:text-red-600 disabled:opacity-50"
                aria-label="Remove search filter"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
          {currentCategory && (
            <span className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] font-medium text-gray-800">
              <span className="capitalize">
                {currentCategoryObj?.name || currentCategory}
              </span>
              <button
                type="button"
                onClick={() => updateQuery({ category: null })}
                disabled={isPending}
                className="hover:text-red-600 disabled:opacity-50"
                aria-label="Remove category filter"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
          {currentBrand && (
            <span className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] font-medium text-gray-800">
              <span>{currentBrandObj?.name || currentBrand}</span>
              <button
                type="button"
                onClick={() => updateQuery({ brand: null })}
                disabled={isPending}
                className="hover:text-red-600 disabled:opacity-50"
                aria-label="Remove brand filter"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
          {(currentMinPrice || currentMaxPrice) && (
            <span className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] font-medium text-gray-800">
              <span>
                ৳{currentMinPrice || "0"} –{" "}
                {currentMaxPrice ? `৳${currentMaxPrice}` : "above"}
              </span>
              <button
                type="button"
                onClick={() => updateQuery({ minPrice: null, maxPrice: null })}
                disabled={isPending}
                className="hover:text-red-600 disabled:opacity-50"
                aria-label="Remove price filter"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
          {currentSizes.map((s) => (
            <span
              key={`badge-size-${s}`}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] font-medium text-gray-800"
            >
              <span>Size: {s}</span>
              <button
                type="button"
                onClick={() => toggleSize(s)}
                disabled={isPending}
                className="hover:text-red-600 disabled:opacity-50"
                aria-label={`Remove size ${s} filter`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {currentColors.map((c) => (
            <span
              key={`badge-color-${c}`}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] font-medium text-gray-800"
            >
              <span>Colour: {c}</span>
              <button
                type="button"
                onClick={() => toggleColor(c)}
                disabled={isPending}
                className="hover:text-red-600 disabled:opacity-50"
                aria-label={`Remove colour ${c} filter`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Accordion Filter Sections */}
      <Accordion
        type="multiple"
        defaultValue={["category", "brand", "price", "size", "color"]}
        className="w-full space-y-1"
      >
        {/* Categories */}
        {categories.length > 0 && (
          <AccordionItem value="category" className="border-b border-gray-100">
            <AccordionTrigger className="py-2.5 text-xs font-bold uppercase tracking-wider text-gray-900 hover:no-underline">
              Categories
            </AccordionTrigger>
            <AccordionContent>
              <div
                className="max-h-56 space-y-0.5 overflow-y-auto pr-1 pt-1"
                role="listbox"
                aria-label="Filter by category"
              >
                {categories.map((cat) => {
                  const active = currentCategory === cat.slug;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => toggleCategory(cat.slug)}
                      disabled={isPending}
                      className={`flex w-full cursor-pointer items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition-colors disabled:cursor-wait ${
                        active
                          ? "bg-black text-white font-medium shadow-sm"
                          : "text-gray-600 hover:bg-gray-100 hover:text-black"
                      }`}
                    >
                      <span className="capitalize">{cat.name}</span>
                      {active && <Check className="h-3.5 w-3.5 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Brands */}
        {brands.length > 0 && (
          <AccordionItem value="brand" className="border-b border-gray-100">
            <AccordionTrigger className="py-2.5 text-xs font-bold uppercase tracking-wider text-gray-900 hover:no-underline">
              Brands
            </AccordionTrigger>
            <AccordionContent>
              <div
                className="max-h-56 space-y-0.5 overflow-y-auto pr-1 pt-1"
                role="listbox"
                aria-label="Filter by brand"
              >
                {brands.map((brand) => {
                  const active = currentBrand === brand.slug;
                  return (
                    <button
                      key={brand.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => toggleBrand(brand.slug)}
                      disabled={isPending}
                      className={`flex w-full cursor-pointer items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition-colors disabled:cursor-wait ${
                        active
                          ? "bg-black text-white font-medium shadow-sm"
                          : "text-gray-600 hover:bg-gray-100 hover:text-black"
                      }`}
                    >
                      <span>{brand.name}</span>
                      {active && <Check className="h-3.5 w-3.5 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Size (variant facet) */}
        {sizes.length > 0 && (
          <AccordionItem value="size" className="border-b border-gray-100">
            <AccordionTrigger className="py-2.5 text-xs font-bold uppercase tracking-wider text-gray-900 hover:no-underline">
              Size
              {currentSizes.length > 0 && (
                <span className="ml-1.5 rounded-full bg-black px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {currentSizes.length}
                </span>
              )}
            </AccordionTrigger>
            <AccordionContent>
              <div
                className="flex flex-wrap gap-1.5 pt-1"
                role="listbox"
                aria-label="Filter by size"
              >
                {sizes.map((size) => {
                  const active = currentSizes.includes(size);
                  return (
                    <button
                      key={size}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => toggleSize(size)}
                      disabled={isPending}
                      className={`min-w-9 rounded-md border px-2 py-1.5 text-center text-xs transition-colors disabled:cursor-wait ${
                        active
                          ? "border-black bg-black text-white font-medium shadow-sm"
                          : "border-gray-200 text-gray-600 hover:border-black hover:text-black"
                      }`}
                    >
                      {size}
                    </button>
                  );
                })}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Colour (variant facet) */}
        {colors.length > 0 && (
          <AccordionItem value="color" className="border-b border-gray-100">
            <AccordionTrigger className="py-2.5 text-xs font-bold uppercase tracking-wider text-gray-900 hover:no-underline">
              Colour
              {currentColors.length > 0 && (
                <span className="ml-1.5 rounded-full bg-black px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {currentColors.length}
                </span>
              )}
            </AccordionTrigger>
            <AccordionContent>
              <div
                className="max-h-56 space-y-0.5 overflow-y-auto pr-1 pt-1"
                role="listbox"
                aria-label="Filter by colour"
              >
                {colors.map((color) => {
                  const active = currentColors.includes(color);
                  return (
                    <button
                      key={color}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => toggleColor(color)}
                      disabled={isPending}
                      className={`flex w-full cursor-pointer items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition-colors disabled:cursor-wait ${
                        active
                          ? "bg-black text-white font-medium shadow-sm"
                          : "text-gray-600 hover:bg-gray-100 hover:text-black"
                      }`}
                    >
                      <span>{color}</span>
                      {active && <Check className="h-3.5 w-3.5 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Price Range */}
        <AccordionItem value="price" className="border-b-0">
          <AccordionTrigger className="py-2.5 text-xs font-bold uppercase tracking-wider text-gray-900 hover:no-underline">
            Price (BDT ৳)
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-3 pt-1">
              {/* Presets */}
              <div
                className="space-y-0.5"
                role="listbox"
                aria-label="Filter by price range"
              >
                {PRICE_PRESETS.map((preset, idx) => {
                  const active =
                    currentMinPrice === preset.min &&
                    (preset.max
                      ? currentMaxPrice === preset.max
                      : !currentMaxPrice);
                  return (
                    <button
                      key={idx}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => applyPricePreset(preset.min, preset.max)}
                      disabled={isPending}
                      className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition-colors disabled:cursor-wait ${
                        active
                          ? "bg-black text-white font-medium shadow-sm"
                          : "text-gray-600 hover:bg-gray-100 hover:text-black"
                      }`}
                    >
                      <span>{preset.label}</span>
                      {active && <Check className="h-3.5 w-3.5 shrink-0" />}
                    </button>
                  );
                })}
              </div>

              {/* Custom Range */}
              <form onSubmit={handleCustomPriceSubmit} className="pt-2">
                <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  Custom Range
                </span>
                <div className="flex items-center gap-1.5">
                  <div className="relative flex-1">
                    <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-gray-400">
                      ৳
                    </span>
                    <input
                      type="number"
                      placeholder="Min"
                      min={0}
                      step={1}
                      value={customMin}
                      onChange={(e) => setCustomMin(e.target.value)}
                      className="h-8 w-full rounded border border-gray-200 pl-5 pr-1 text-xs focus:border-black focus:outline-none"
                    />
                  </div>
                  <span className="text-xs text-gray-400">–</span>
                  <div className="relative flex-1">
                    <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-gray-400">
                      ৳
                    </span>
                    <input
                      type="number"
                      placeholder="Max"
                      min={0}
                      step={1}
                      value={customMax}
                      onChange={(e) => setCustomMax(e.target.value)}
                      className="h-8 w-full rounded border border-gray-200 pl-5 pr-1 text-xs focus:border-black focus:outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isPending}
                    className="h-8 rounded bg-black px-2.5 text-xs font-medium text-white transition-colors hover:bg-[#C9A86A] disabled:opacity-50"
                  >
                    Go
                  </button>
                </div>
              </form>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Mobile Drawer Bottom Action */}
      {onClose && (
        <div className="pt-4 border-t border-gray-100">
          <Button
            type="button"
            onClick={onClose}
            className="w-full rounded-full bg-black text-white hover:bg-[#C9A86A] text-xs font-semibold uppercase tracking-wider py-2.5"
          >
            {productCount !== undefined
              ? `View ${productCount} Products`
              : "Apply Filters"}
          </Button>
        </div>
      )}
    </div>
  );
}
