import { Metadata } from "next";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { ProductsTable } from "@/features/admin/components/products/ProductsTable";
import { getAdminProductsAction } from "@/lib/actions/admin/products.actions";

export const metadata: Metadata = {
  title: "Products | Admin Dashboard",
  description: "Manage your store catalog and products.",
};

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; page?: string; status?: string }>;
}) {
  const search = (await searchParams).search || "";
  const page = parseInt((await searchParams).page || "1", 10);
  const status = (await searchParams).status;

  const res = await getAdminProductsAction({ search, page, limit: 20, status });

  const products = res.data?.products || [];
  const totalCount = res.data?.total || 0;

  return (
    <div className="mx-auto max-w-[1600px] space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Products
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage your catalog, inventory, and product visibility.
          </p>
        </div>
        <Link
          href="/admin/products/trash"
          className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
        >
          <Trash2 className="h-4 w-4" />
          Trash (30-day restore)
        </Link>
      </div>

      <ProductsTable
        initialProducts={products}
        totalCount={totalCount}
        currentPage={page}
        pageSize={20}
      />
    </div>
  );
}
