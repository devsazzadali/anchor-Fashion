"use client";

import { useEffect, useRef } from "react";
import { useCheckoutStore } from "@/stores/use-checkout-store";
import { useCartStore } from "@/stores/use-cart-store";

import { CheckoutSession, Cart } from "@/types/checkout.types";

export function CheckoutStoreInitializer({
  cartId,
  initialSession,
  initialCart,
}: {
  cartId: string;
  initialSession?: CheckoutSession | null;
  initialCart?: Cart | null;
}) {
  const initialized = useRef(false);
  const { fetchSession, setSession } = useCheckoutStore();
  const setCart = useCartStore((s) => s.setCart);
  const fetchCart = useCartStore((s) => s.fetchCart);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      if (initialSession) {
        setSession(initialSession);
      } else {
        fetchSession(cartId);
      }
      // The checkout layout never triggers the cart store's fetch on its own
      // (the header/cart components that do so elsewhere are absent here),
      // which left the Order Summary reading an empty store and rendering
      // ৳0 totals. Seed the store with the server-fetched cart, then refresh
      // from the server so later cart changes are reflected too.
      if (initialCart) {
        setCart(initialCart);
      }
      fetchCart();
    }
  }, [cartId, initialSession, initialCart, fetchSession, setSession, setCart, fetchCart]);

  return null;
}
