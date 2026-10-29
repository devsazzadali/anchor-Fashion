import { CatalogRepository, ProductListParams } from "@/repositories/catalog.repository";
import { CatalogService } from "@/lib/services/catalog.service";
import { Category } from "@/types/category";

export const getCategoryBySlug = async (
  slug: string
): Promise<Category | null> => {
  const cleanSlug = slug.toLowerCase().trim();
  const categories = await CatalogRepository.getCategories();
  const matched = (categories as any[]).find(
    (c) => c.slug?.toLowerCase() === cleanSlug
  );
  if (matched) {
    return matched as Category;
  }

  // Phase 9 (no-hardcode rule): unknown slugs return null — the category
  // page renders an honest empty state with a humanized slug heading. The
  // previous "virtual category" map fabricated categories (men/women/kids/
  // sale…) that do not exist in the database.
  return null;
};

export const getCategories = async (): Promise<Category[]> => {
  const categories = await CatalogRepository.getCategories();
  return (categories || []) as Category[];
};

export const getProducts = async (params?: {
  categoryId?: string;
  categorySlug?: string;
  brand?: string;
  minPrice?: number;
  maxPrice?: number;
  search?: string;
  sortBy?: string;
  limit?: number;
  offset?: number;
}): Promise<any[]> => {
  const slug = params?.categorySlug?.toLowerCase();
  let sortBy: ProductListParams["sortBy"] = "newest";
  if (
    params?.sortBy === "price_asc" ||
    params?.sortBy === "price_desc" ||
    params?.sortBy === "rating" ||
    params?.sortBy === "newest"
  ) {
    sortBy = params.sortBy;
  }

  const { data } = await CatalogRepository.getProducts({
    category: slug,
    brand: params?.brand,
    minPrice: params?.minPrice,
    maxPrice: params?.maxPrice,
    search: params?.search,
    sortBy,
    limit: params?.limit || 24,
    offset: params?.offset || 0,
  });

  return data || [];
};

export const getBrands = async (): Promise<any[]> => {
  const brands = await CatalogService.getBrands();
  return (brands || []) as any[];
};
