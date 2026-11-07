"use client";

import { useCartStore } from "@/stores/use-cart-store";
import { useCheckoutStore } from "@/stores/use-checkout-store";
import { formatCurrency } from "@/lib/utils";
import Image from "next/image";
import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { applyCouponAction, removeCouponAction } from "@/actions/checkout.actions";
import { useToast } from "@/hooks/use-toast";
import { totalVatAmount } from "@/lib/utils/vat";
import { getPublicZonesAction } from "@/lib/actions/shipping.actions";
import { getStoreInfo } from "@/lib/actions/settings.actions";
import {
  pickZone,
  defaultZone,
  type PublicZone,
} from "@/lib/services/shipping/zone-shared";

export function OrderSummary() {
  const { cart } = useCartStore();
  const { formData, session } = useCheckoutStore();
  const { toast } = useToast();
  const [couponCode, setCouponCode] = useState("");
  const [isApplying, setIsApplying] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState<{
    code: string;
    discount: number;
  } | null>(null);

  const items = cart?.items || [];

  const subtotal = items.reduce((sum, item) => {
    const price =
      item.variant?.sale_price ||
      item.variant?.price ||
      item.product?.sale_price ||
      item.product?.price ||
      0;
    return sum + price * item.quantity;
  }, 0);

  const shippingMethod = formData.shipping?.shipping_method;
  // Delivery charge mirrors the server's zone resolution: admin-configured
  // zones (Settings → Store) matched by the customer's city/district, with
  // the default zone as fallback. Legacy flat rates only until zones load.
  const [zones, setZones] = useState<PublicZone[]>([]);
  useEffect(() => {
    let cancelled = false;
    getPublicZonesAction()
      .then((res) => {
        if (!cancelled && res.success) setZones(res.data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const cityForZone = formData.information?.shipping_address?.city || "";
  const zoneFee = (() => {
    if (subtotal <= 0) return 0;
    if (zones.length > 0) {
      const zone =
        shippingMethod === "home_delivery_outside"
          ? defaultZone(zones)
          : pickZone(zones, cityForZone, cityForZone);
      if (zone) return zone.rate;
    }
    return shippingMethod === "home_delivery_outside" ? 150 : 100;
  })();
  // Free-shipping threshold (Settings → Store Info, advertised in the
  // announcement bar and cart): at/above it delivery is free. Mirrors the
  // server's OrderService.calculateSummary so the displayed total matches
  // the charged total. BUG FIX: this display previously never consulted
  // the threshold and kept showing the zone fee on qualifying orders.
  const [freeThreshold, setFreeThreshold] = useState(0);
  useEffect(() => {
    let cancelled = false;
    getStoreInfo()
      .then((info) => {
        if (!cancelled) {
          setFreeThreshold(parseFloat(info?.free_shipping_threshold ?? "") || 0);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const shippingFee =
    freeThreshold > 0 && subtotal >= freeThreshold ? 0 : zoneFee;
  // Real per-product VAT (each product's vat_percent, added on top of its
  // selling price) — identical to the server's OrderService.calculateSummary.
  // (This replaces a hardcoded 15% "estimated tax" that the server never
  // actually charged, so the displayed total now matches the charged total.)
  const resolveItemPrice = (item: any) =>
    item.variant?.sale_price ||
    item.variant?.price ||
    item.product?.sale_price ||
    item.product?.price ||
    0;
  const tax = totalVatAmount(
    items.map((item) => ({
      unitPrice: resolveItemPrice(item),
      quantity: item.quantity,
      vatPercent: (item.product as any)?.vat_percent ?? 0,
    }))
  );
  const discount = appliedCoupon ? appliedCoupon.discount : 0;
  const total = Math.max(0, subtotal + shippingFee + tax - discount);

  useEffect(() => {
    // If session loads and has a coupon code but we haven't applied it locally
    if (session?.coupon_code && !appliedCoupon) {
      handleApplyCoupon(session.coupon_code);
    }
  }, [session?.coupon_code]);

  const handleApplyCoupon = async (codeToApply?: string) => {
    const code = codeToApply || couponCode;
    if (!code.trim() || !session?.id) return;
    
    setIsApplying(true);
    try {
      const res = await applyCouponAction(session.id, code, subtotal);
      if (res.success && res.discount !== undefined) {
        setAppliedCoupon({ code: res.code || code, discount: res.discount });
        setCouponCode("");
        if (!codeToApply) {
          toast({ title: "Coupon applied successfully" });
        }
      } else {
        toast({ title: "Coupon Error", description: res.error, variant: "destructive" });
        setAppliedCoupon(null);
      }
    } catch (err) {
      toast({ title: "Failed to apply coupon", variant: "destructive" });
    } finally {
      setIsApplying(false);
    }
  };

  const handleRemoveCoupon = async () => {
    if (!session?.id) return;
    setIsApplying(true);
    try {
      await removeCouponAction(session.id);
      setAppliedCoupon(null);
      setCouponCode("");
      toast({ title: "Coupon removed" });
    } catch (err) {
      toast({ title: "Failed to remove coupon", variant: "destructive" });
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="rounded-lg border bg-[#fcfaf9] p-6 lg:p-8">
      <h2 className="mb-6 text-xl font-light tracking-tight text-[#1A1A1A]">Order Summary</h2>

      <div className="mb-6 max-h-[300px] space-y-4 overflow-y-auto pr-2">
        {items.map((item) => {
          const price =
            item.variant?.sale_price ||
            item.variant?.price ||
            item.product?.sale_price ||
            item.product?.price ||
            0;
          const image = item.product?.main_image_url || "/placeholder.png";

          return (
            <div key={item.id} className="flex gap-4">
              <div className="relative h-16 w-16 overflow-hidden rounded-md border bg-white">
                <Image
                  src={image}
                  alt={item.product?.title || ""}
                  fill
                  sizes="64px"
                  className="object-cover"
                />
                <div className="absolute -right-2 -top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-slate-500 text-xs text-white">
                  {item.quantity}
                </div>
              </div>
              <div className="flex flex-1 flex-col justify-center">
                <h4 className="line-clamp-2 text-sm font-medium">
                  {item.product?.title}
                </h4>
                {item.variant && (
                  <p className="text-xs text-slate-500">
                    {Object.values(item.variant.attributes).join(", ")}
                  </p>
                )}
              </div>
              <div className="flex items-center text-sm font-medium">
                {formatCurrency(price * item.quantity)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mb-6 border-t pt-6">
        <h3 className="mb-3 text-sm font-medium">Gift Card or Discount Code</h3>
        {appliedCoupon ? (
          <div className="flex items-center justify-between rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
            <span className="font-medium">{appliedCoupon.code}</span>
            <button
              onClick={handleRemoveCoupon}
              disabled={isApplying}
              className="text-xs underline hover:text-green-900 disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Input
              placeholder="Enter discount code"
              value={couponCode}
              onChange={(e) => setCouponCode(e.target.value)}
              className="flex-1"
              disabled={isApplying}
            />
            <Button variant="secondary" onClick={() => handleApplyCoupon()} disabled={isApplying} className="bg-[#1A1A1A] text-white hover:bg-black uppercase tracking-widest text-xs">
              Apply
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-3 border-t pt-6 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-500">Subtotal</span>
          <span className="font-medium">{formatCurrency(subtotal)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Shipping</span>
          <span className="font-medium">
            {shippingFee > 0 ? formatCurrency(shippingFee) : "Free"}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">VAT</span>
          <span className="font-medium">{formatCurrency(tax)}</span>
        </div>
        {discount > 0 && (
          <div className="flex justify-between text-green-600">
            <span>Discount</span>
            <span className="font-medium">-{formatCurrency(discount)}</span>
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between border-t border-gray-200 pt-6">
        <span className="text-lg font-medium text-[#1A1A1A]">Total</span>
        <span className="text-2xl font-semibold text-[#1A1A1A]">{formatCurrency(total)}</span>
      </div>

      <div className="mt-8 pt-6 border-t border-gray-100 flex flex-col gap-3">
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <RefreshCw className="h-4 w-4" />
          <span>7-Day Easy Return Policy on unworn items.</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <ShieldCheck className="h-4 w-4" />
          <span>Original Anchor Fashion Guarantee.</span>
        </div>
      </div>
    </div>
  );
}
