"use client";

import { useWishlistStore } from "@/stores/use-wishlist-store";
import { Button } from "@/components/ui/button";
import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface WishlistButtonProps {
  productId: string;
  className?: string;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
}

export function WishlistButton({
  productId,
  className,
  variant = "outline",
  size = "icon",
}: WishlistButtonProps) {
  const { wishlist, addItem, removeItem, isLoading } = useWishlistStore();

  // Check if item is in wishlist
  const wishlistItem = wishlist?.items?.find(
    (item) => item.product_id === productId
  );
  const isWishlisted = !!wishlistItem;

  const handleToggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // A3-C5: no auth gate — guests save to the device (local) wishlist,
    // signed-in users sync to their account (the store handles both).

    if (isWishlisted && wishlistItem) {
      await removeItem(wishlistItem.id);
      toast.success("Removed from wishlist");
    } else {
      await addItem(productId);
      toast.success("Added to wishlist ❤️");
    }
  };

  return (
    <Button
      variant={variant}
      size={size}
      className={cn("transition-colors", className)}
      onClick={handleToggle}
      disabled={isLoading}
      title={isWishlisted ? "Remove from wishlist" : "Add to wishlist"}
    >
      <Heart
        className={cn(
          "h-5 w-5 transition-transform hover:scale-110",
          isWishlisted && "fill-red-600 text-red-600"
        )}
      />
    </Button>
  );
}
