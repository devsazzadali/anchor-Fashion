"use client";

import React from "react";
import Link from "next/link";
import { PackageOpen, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface FulfillmentOrderRow {
  id: string;
  orderNumber: string;
  /** ISO string */
  createdAt: string;
  status: string;
  customerName: string;
  itemsCount: number;
  totalAmount: number;
  courier: string | null;
  trackingNumber: string | null;
  shipment: {
    courier: string | null;
    status: string | null;
    trackingNumber: string | null;
  } | null;
}

interface FulfillmentClientProps {
  orders: FulfillmentOrderRow[];
}

const FULFILLMENT_STATUSES = ["CONFIRMED", "PREPARING", "PACKING"] as const;

function formatBDT(amount: number): string {
  return `৳${Number(amount || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function StatusBadge({ status }: { status: string }) {
  switch ((status || "").toUpperCase()) {
    case "CONFIRMED":
      return (
        <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25">
          Confirmed
        </Badge>
      );
    case "PREPARING":
      return (
        <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30 hover:bg-blue-500/25">
          Preparing
        </Badge>
      );
    case "PACKING":
      return (
        <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/25">
          Packing
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function courierState(order: FulfillmentOrderRow): string {
  if (order.shipment) {
    const parts = [
      order.shipment.courier || "Courier",
      order.shipment.status || null,
      order.shipment.trackingNumber ? `#${order.shipment.trackingNumber}` : null,
    ].filter(Boolean);
    return parts.join(" · ");
  }
  if (order.courier || order.trackingNumber) {
    const parts = [
      order.courier || "Courier",
      order.trackingNumber ? `#${order.trackingNumber}` : null,
    ].filter(Boolean);
    return parts.join(" · ");
  }
  return "Not shipped";
}

export function FulfillmentClient({ orders = [] }: FulfillmentClientProps) {
  const countsByStatus = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const status of FULFILLMENT_STATUSES) counts[status] = 0;
    for (const order of orders) {
      const key = (order.status || "").toUpperCase();
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [orders]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Fulfillment Workspace</h2>
        <p className="text-muted-foreground">
          Orders awaiting fulfillment — confirmed, preparing, and packing — oldest first.
        </p>
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="px-3 py-1 text-sm">
          Awaiting fulfillment: {orders.length}
        </Badge>
        {FULFILLMENT_STATUSES.map((status) => (
          <Badge key={status} variant="secondary" className="px-3 py-1 text-sm capitalize">
            {status.toLowerCase()}: {countsByStatus[status] || 0}
          </Badge>
        ))}
      </div>

      {/* Orders table */}
      <div className="rounded-md border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead className="text-right">Items</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Courier</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((order) => (
              <TableRow key={order.id}>
                <TableCell className="font-medium">
                  <Link
                    href={`/admin/orders/${order.id}`}
                    className="font-mono hover:text-primary hover:underline underline-offset-4"
                  >
                    {order.orderNumber}
                  </Link>
                </TableCell>
                <TableCell>{formatDate(order.createdAt)}</TableCell>
                <TableCell>{order.customerName}</TableCell>
                <TableCell className="text-right">{order.itemsCount}</TableCell>
                <TableCell className="text-right font-semibold">
                  {formatBDT(order.totalAmount)}
                </TableCell>
                <TableCell>
                  <StatusBadge status={order.status} />
                </TableCell>
                <TableCell className="text-muted-foreground">{courierState(order)}</TableCell>
                <TableCell className="text-right">
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/admin/orders/${order.id}`}>
                      <Eye className="mr-1.5 h-3.5 w-3.5" />
                      View order
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}

            {orders.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <PackageOpen className="h-8 w-8 text-muted-foreground/50" />
                    <p className="font-medium text-foreground">No orders awaiting fulfillment</p>
                    <p className="text-sm">
                      There are currently no confirmed, preparing, or packing orders to fulfil.
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
