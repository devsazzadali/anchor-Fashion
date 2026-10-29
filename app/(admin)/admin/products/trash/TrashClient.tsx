"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, RotateCcw, Trash2, Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  permanentlyDeleteAdminProductAction,
  purgeExpiredTrashAction,
  restoreAdminProductAction,
} from "@/lib/actions/admin/products.actions";

export interface TrashedProductRow {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  price: number;
  imageUrl: string | null;
  categoryName: string | null;
  preTrashStatus: string;
  deletedAt: string | null;
  daysRemaining: number;
}

export default function TrashClient({
  initialRows,
  total,
}: {
  initialRows: TrashedProductRow[];
  total: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const run = (id: string | null, fn: () => Promise<any>, okMsg: string) => {
    setBusyId(id);
    startTransition(async () => {
      const res: any = await fn();
      setBusyId(null);
      if (res?.success === false || res?.error) {
        toast.error(res.error || "Action failed");
        return;
      }
      toast.success(okMsg);
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {total} product{total === 1 ? "" : "s"} in trash. Trashed products
          are hidden from the storefront and the product list, and are
          permanently deleted automatically after 30 days.
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() =>
            run(null, () => purgeExpiredTrashAction({}), "Expired trash purged")
          }
        >
          <Eraser className="mr-2 h-4 w-4" />
          Purge expired now
        </Button>
      </div>

      <div className="rounded-md border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Was</TableHead>
              <TableHead>Deleted</TableHead>
              <TableHead>Auto-purge in</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  The trash is empty.
                </TableCell>
              </TableRow>
            )}
            {initialRows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    {row.imageUrl ? (
                      <Image
                        src={row.imageUrl}
                        alt={row.name}
                        width={40}
                        height={40}
                        className="h-10 w-10 rounded object-cover"
                      />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded bg-muted text-[10px] text-muted-foreground">
                        No img
                      </div>
                    )}
                    <div>
                      <p className="font-medium leading-tight">{row.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.categoryName || "—"}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-sm">{row.sku || "—"}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{row.preTrashStatus}</Badge>
                </TableCell>
                <TableCell className="text-sm">
                  {row.deletedAt
                    ? new Date(row.deletedAt).toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })
                    : "—"}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={row.daysRemaining <= 3 ? "destructive" : "outline"}
                  >
                    {row.daysRemaining} day{row.daysRemaining === 1 ? "" : "s"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending && busyId === row.id}
                      onClick={() =>
                        run(
                          row.id,
                          () => restoreAdminProductAction({ id: row.id }),
                          "Product restored"
                        )
                      }
                    >
                      {pending && busyId === row.id ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Restore
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={pending && busyId === row.id}
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Permanently delete "${row.name}"? This cannot be undone.`
                          )
                        )
                          return;
                        run(
                          row.id,
                          () =>
                            permanentlyDeleteAdminProductAction({
                              id: row.id,
                            }),
                          "Product permanently deleted"
                        );
                      }}
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      Delete forever
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
