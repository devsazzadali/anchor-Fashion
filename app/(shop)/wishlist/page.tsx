import { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GuestWishlist } from "@/components/wishlist/guest-wishlist";
import { createDbClient } from "@/lib/db/client";
import { jost } from "@/lib/fonts";

export const metadata: Metadata = {
  title: "My Wishlist | Anchor Fashion",
  description: "View your saved items.",
};

/**
 * FIX ROUND 29 (D1): /wishlist previously resolved to the branded 404
 * — the only wishlist route lived under /account/wishlist, which
 * bounces guests to login. This public route is the guest front door:
 * signed-in shoppers go straight to their account wishlist (behaviour
 * unchanged); guests get a real wishlist page — their on-device saved
 * items, an honest empty state, and a sign-in nudge.
 */
export default async function PublicWishlistPage() {
  const db = await createDbClient();
  const {
    data: { user },
  } = await db.auth.getUser();

  if (user) {
    redirect("/account/wishlist");
  }

  return (
    <div className={`${jost.className} container mx-auto px-4 py-8 md:py-14 min-h-[75vh]`}>
      <div className="mb-8">
        <h1 className="text-2xl font-light tracking-tight text-[#1A1A1A] sm:text-3xl">
          My Wishlist
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          Items you&apos;ve saved for later on this device.
        </p>
      </div>

      <div className="mb-8 flex flex-col items-start justify-between gap-3 rounded-xl border border-[#C9A86A]/40 bg-amber-50/60 p-4 sm:flex-row sm:items-center">
        <p className="text-sm text-slate-700">
          <span className="font-semibold">Shopping as a guest.</span> Sign in
          to sync your wishlist with your account and see it on any device.
        </p>
        <Button asChild size="sm" className="shrink-0 bg-[#1A1A1A] text-white hover:bg-black">
          <Link href="/auth/login?redirect=/account/wishlist">
            <LogIn className="mr-2 h-3.5 w-3.5" /> Sign In
          </Link>
        </Button>
      </div>

      <GuestWishlist />
    </div>
  );
}
