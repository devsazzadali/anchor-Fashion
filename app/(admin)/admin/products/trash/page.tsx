import { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getTrashedProductsAction } from "@/lib/actions/admin/products.actions";
import TrashClient from "./TrashClient";

export const metadata: Metadata = {
  title: "Product Trash | Admin Dashboard",
  description:
    "Deleted products stay here for 30 days — restore them or delete them forever.",
};

export default async function ProductTrashPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const search = sp.search || "";
  const page = parseInt(sp.page || "1", 10);
  const res: any = await getTrashedProductsAction({ search, page, limit: 50 });
  const rows = res?.data?.data || [];
  const total = res?.data?.total || 0;

  return (
    <div className="mx-auto max-w-[1600px] space-y-6">
      <div>
        <Link
          href="/admin/products"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Products
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
          Product Trash
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Deleting a product moves it here for 30 days instead of erasing it.
        </p>
      </div>
      <TrashClient initialRows={rows} total={total} />
    </div>
  );
}
