"use server";

import { WishlistService } from "@/services/wishlist.service";
import { revalidatePath } from "next/cache";
import { createDbClient } from "@/lib/db/client";

async function requireAuth() {
  const db = await createDbClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) throw new Error("Authentication required for wishlist");
  return user.id;
}

export async function fetchWishlistAction() {
  const userId = await requireAuth();
  const wishlistService = new WishlistService();
  return await wishlistService.initializeWishlist(userId);
}

export async function addToWishlistAction(productId: string) {
  const userId = await requireAuth();
  const wishlistService = new WishlistService();
  await wishlistService.addToWishlist(userId, productId);
  revalidatePath("/wishlist");
}

export async function removeFromWishlistAction(itemId: string) {
  await requireAuth();
  const wishlistService = new WishlistService();
  await wishlistService.removeFromWishlist(itemId);
  revalidatePath("/wishlist");
}

export async function moveWishlistItemToCartAction(
  cartId: string,
  productId: string,
  wishlistId: string
) {
  const userId = await requireAuth();
  const wishlistService = new WishlistService();
  await wishlistService.moveToCart(userId, cartId, productId, wishlistId);
  revalidatePath("/wishlist");
  revalidatePath("/cart");
}
