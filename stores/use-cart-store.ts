import { create } from "zustand";
import { Cart } from "@/types/checkout.types";
import {
  fetchCartAction,
  addToCartAction,
  updateCartItemQuantityAction,
  removeFromCartAction,
  clearCartAction,
} from "@/lib/actions/cart.actions";

interface CartState {
  cart: Cart | null;
  isLoading: boolean;
  error: string | null;
  isSheetOpen: boolean;

  setSheetOpen: (open: boolean) => void;
  setCart: (cart: Cart | null) => void;
  fetchCart: () => Promise<void>;
  addItem: (
    productId: string,
    variantId: string | null,
    quantity: number,
    options?: { openSheet?: boolean }
  ) => Promise<void>;
  updateQuantity: (itemId: string, quantity: number) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
  clearCart: () => Promise<void>;
}

// NOTE: this store is intentionally NOT persisted. The previous zustand
// `persist` setup stored ONLY `isSheetOpen` — so a drawer left open (or
// opened by an Add to Bag) was restored from localStorage on every page
// load and navigation, springing the cart drawer over whatever page the
// customer had moved to and masking client-side navigations (the Buy Now
// / drawer-checkout flows appeared to "not navigate"). The cart itself is
// server-owned and re-fetched; nothing else was ever persisted.
export const useCartStore = create<CartState>()(
    (set, get) => ({
      cart: null,
      isLoading: false,
      error: null,
      isSheetOpen: false,

      setSheetOpen: (open) => set({ isSheetOpen: open }),

      setCart: (cart) => set({ cart }),

      fetchCart: async () => {
        set({ isLoading: true, error: null });
        const res = await fetchCartAction();
        if (res.success) {
          set({ cart: res.cart, isLoading: false });
        } else {
          set({ error: res.error, isLoading: false });
        }
      },

      addItem: async (productId, variantId, quantity, options) => {
        set({ isLoading: true, error: null });
        const res = await addToCartAction(productId, variantId, quantity);
        if (res.success) {
          await get().fetchCart();
          // Add to Bag opens the drawer (default). Buy Now passes
          // openSheet: false — it navigates straight to /checkout, and
          // opening the drawer as a side effect fought that navigation.
          set({ isSheetOpen: options?.openSheet ?? true });
        } else {
          set({ error: res.error, isLoading: false });
          throw new Error(res.error || "Failed to add item to cart");
        }
      },

      updateQuantity: async (itemId, quantity) => {
        const previousCart = get().cart;

        // Optimistic update
        if (previousCart) {
          const updatedItems = (previousCart.items || []).map((item) =>
            item.id === itemId ? { ...item, quantity } : item
          );
          set({ cart: { ...previousCart, items: updatedItems } });
        }

        set({ isLoading: true, error: null });
        const res = await updateCartItemQuantityAction(itemId, quantity);
        if (res.success) {
          await get().fetchCart();
        } else {
          // Revert on failure
          if (previousCart) set({ cart: previousCart });
          set({ error: res.error, isLoading: false });
        }
      },

      removeItem: async (itemId) => {
        const previousCart = get().cart;

        // Optimistic update
        if (previousCart) {
          const updatedItems = (previousCart.items || []).filter(
            (item) => item.id !== itemId
          );
          set({ cart: { ...previousCart, items: updatedItems } });
        }

        set({ isLoading: true, error: null });
        const res = await removeFromCartAction(itemId);
        if (res.success) {
          await get().fetchCart();
        } else {
          // Revert on failure
          if (previousCart) set({ cart: previousCart });
          set({ error: res.error, isLoading: false });
        }
      },

      clearCart: async () => {
        const cart = get().cart;
        if (!cart) return;
        set({ isLoading: true, error: null });
        const res = await clearCartAction(cart.id);
        if (res.success) {
          set({ cart: { ...cart, items: [] }, isLoading: false });
        } else {
          set({ error: res.error, isLoading: false });
        }
      },
    })
);
