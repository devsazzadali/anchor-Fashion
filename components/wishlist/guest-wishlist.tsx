"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Heart, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWishlistStore } from "@/stores/use-wishlist-store";
import { formatCurrency } from "@/lib/utils";
import { priceWithVat } from "@/lib/utils/vat";
import { toast } from "sonner";

interface FeedProduct {
  id: string;
  name: string;
  slug: string;
  price: number;
  sale_price: number | null;
  vat_percent: number;
  category: string;
  image_url: string;
}

/**
 * FIX ROUND 29 (D1): the guest wishlist. Guests' saved items live only
 * in the persisted local store (product ids); this resolves them
 * against the public product feed so a guest sees a real wishlist —
 * and an honest empty state when nothing is saved on this device.
 */
export function GuestWishlist() {
  const { wishlist, removeItemByProductId } = useWishlistStore();
  const [mounted, setMounted] = useState(false);
  const [products, setProducts] = useState<FeedProduct[] | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const productIds = useMemo(
    () =>
      [...new Set((wishlist?.items || []).map((i) => i.product_id).filter(Boolean))],
    [wishlist]
  );

  useEffect(() => {
    if (!mounted) return;
    if (productIds.length === 0) {
      setProducts([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/store/products?ids=${productIds.join(",")}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (!cancelled) setProducts(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setProducts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mounted, productIds]);

  const handleRemove = async (productId: string) => {
    await removeItemByProductId(productId);
    toast.success("Removed from wishlist");
  };

  if (!mounted || products === null) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center rounded-xl border border-dashed text-center">
        <Heart className="mb-4 h-16 w-16 text-slate-300" />
        <h3 className="mb-2 text-xl font-semibold">Your wishlist is empty</h3>
        <p className="mb-6 max-w-sm text-slate-500">
          Save items you love and buy them later. Items you save as a guest
          stay on this device — sign in to keep them with your account.
        </p>
        <Button
          asChild
          className="rounded-full bg-black px-8 py-2.5 text-xs font-semibold uppercase tracking-wider text-white transition-colors hover:bg-[#C9A86A]"
        >
          <Link href="/products">Explore Products</Link>
        </Button>
      </div>
    );
  }

  // Preserve the order the shopper saved the items in.
  const ordered = productIds
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is FeedProduct => Boolean(p));

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
      {ordered.map((product) => {
        const displayPrice = priceWithVat(
          product.sale_price ?? product.price,
          Number(product.vat_percent || 0)
        );
        return (
          <div key={product.id} className="group flex flex-col">
            <div className="relative overflow-hidden rounded-xl bg-slate-100">
              <Link href={`/product/${product.slug}`}>
                <Image
                  src={product.image_url}
                  alt={product.name}
                  width={600}
                  height={750}
                  className="aspect-[4/5] w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              </Link>
              <button
                onClick={() => handleRemove(product.id)}
                aria-label={`Remove ${product.name} from wishlist`}
                className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-slate-600 shadow transition-colors hover:text-red-500"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-1 flex-col pt-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                {product.category}
              </p>
              <Link
                href={`/product/${product.slug}`}
                className="mt-0.5 text-sm font-medium text-slate-900 hover:underline"
              >
                {product.name}
              </Link>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {formatCurrency(displayPrice)}
                {Number(product.vat_percent || 0) > 0 && (
                  <span className="ml-1 text-[11px] font-normal text-slate-400">
                    incl. VAT
                  </span>
                )}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
