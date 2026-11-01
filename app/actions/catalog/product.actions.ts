"use server";

import { revalidatePath } from "next/cache";
import { CreateProductInput, CreateProductSchema } from "@/types/catalog.types";
import { ProductRepository } from "@/lib/repositories/catalog/product.repository";
import { invalidateProductCache } from "@/lib/cache/invalidate-catalog";
import { verifyStaffOrManager } from "@/lib/security/roles";

export async function createProductAction(input: CreateProductInput) {
  try {
    await verifyStaffOrManager();
    const validated = CreateProductSchema.parse(input);
    const product = await ProductRepository.createProduct(validated);

    revalidatePath("/admin/products");
    revalidatePath("/admin/catalog/products");
    invalidateProductCache(product?.slug);
    return { success: true, data: product };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message || "Failed to create product",
    };
  }
}

export async function updateProductAction(
  id: string,
  input: Partial<CreateProductInput>
) {
  try {
    await verifyStaffOrManager();
    const product = await ProductRepository.updateProduct(id, input);

    revalidatePath("/admin/products");
    revalidatePath(`/admin/products/${id}/edit`);
    revalidatePath("/admin/catalog/products");
    revalidatePath(`/admin/catalog/products/${id}`);
    invalidateProductCache(product?.slug);
    return { success: true, data: product };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message || "Failed to update product",
    };
  }
}

export async function deleteProductAction(id: string) {
  try {
    await verifyStaffOrManager();
    await ProductRepository.deleteProduct(id);

    revalidatePath("/admin/products");
    revalidatePath("/admin/catalog/products");
    invalidateProductCache();
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message || "Failed to delete product",
    };
  }
}

