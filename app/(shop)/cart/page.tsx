import { Metadata } from "next";
import { fetchCartAction } from "@/lib/actions/cart.actions";
import { getFreeShippingThreshold } from "@/lib/actions/settings.actions";
import { CartClient } from "@/components/cart/cart-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your Cart | Anchor Fashion",
  description: "Review your cart items before checkout.",
};

export default async function CartPage() {
  const [{ cart, success }, freeShippingThreshold] = await Promise.all([
    fetchCartAction(),
    getFreeShippingThreshold().catch(() => 0),
  ]);

  return (
    <CartClient
      initialCart={success && cart ? cart : null}
      freeShippingThreshold={freeShippingThreshold}
    />
  );
}
