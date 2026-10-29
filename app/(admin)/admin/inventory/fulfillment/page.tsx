import { Metadata } from "next";
import { FulfillmentClient } from "@/features/inventory/components/FulfillmentClient";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  title: "Warehouse Fulfillment | Anchor Fashion",
  description: "Manage wave batches, pick lists, packing, and dispatch operations.",
};

export const dynamic = "force-dynamic";

// Order statuses that mean "awaiting fulfillment" (not yet shipped/delivered).
const AWAITING_FULFILLMENT_STATUSES = ["CONFIRMED", "PREPARING", "PACKING"] as const;

/**
 * Derive the display customer name for an order, following the same
 * precedence used by the admin order views:
 *   1. the linked Customer record's name,
 *   2. the linked Profile's first/last name,
 *   3. the recipient name stored in the shippingAddress JSON
 *      (recipient_name / name / first+last name fields),
 *   4. a plain "Guest Customer" fallback.
 */
function resolveCustomerName(order: {
  customer?: { name?: string | null } | null;
  profile?: { firstName?: string | null; lastName?: string | null } | null;
  shippingAddress?: unknown;
}): string {
  const customerName = order.customer?.name?.trim();
  if (customerName) return customerName;

  const profileName = [order.profile?.firstName, order.profile?.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  if (profileName) return profileName;

  const addr =
    order.shippingAddress && typeof order.shippingAddress === "object" && !Array.isArray(order.shippingAddress)
      ? (order.shippingAddress as Record<string, any>)
      : null;
  if (addr) {
    const recipient =
      (typeof addr.recipient_name === "string" && addr.recipient_name.trim()) ||
      (typeof addr.recipientName === "string" && addr.recipientName.trim()) ||
      (typeof addr.name === "string" && addr.name.trim()) ||
      (typeof addr.full_name === "string" && addr.full_name.trim()) ||
      (typeof addr.fullName === "string" && addr.fullName.trim()) ||
      [addr.firstName, addr.first_name, addr.lastName, addr.last_name]
        .map((part) => (typeof part === "string" ? part.trim() : ""))
        .filter(Boolean)
        .join(" ")
        .trim();
    if (recipient) return recipient;
  }

  return "Guest Customer";
}

export default async function FulfillmentPage() {
  // Prisma is the reliable path here: the fluent builder's select-embed
  // syntax does not resolve relation objects for these tables.
  const orders = await prisma.order.findMany({
    where: { status: { in: [...AWAITING_FULFILLMENT_STATUSES] } },
    orderBy: { createdAt: "asc" }, // oldest first — fulfil in arrival order
    include: {
      _count: { select: { items: true } },
      items: { select: { id: true, quantity: true } },
      customer: { select: { name: true } },
      profile: { select: { firstName: true, lastName: true } },
      shipments: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          courier: true,
          courierProviderCode: true,
          status: true,
          trackingNumber: true,
        },
      },
    },
  });

  const rows = orders.map((order) => {
    const latestShipment = order.shipments[0] ?? null;
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      createdAt: order.createdAt.toISOString(),
      status: order.status,
      customerName: resolveCustomerName(order),
      // Total units to pick (sum of line quantities); falls back to the
      // line-item count from _count when no item rows were returned.
      itemsCount:
        order.items.length > 0
          ? order.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)
          : order._count.items,
      totalAmount: Number(order.totalAmount ?? 0),
      courier: order.courier ?? null,
      trackingNumber: order.trackingNumber ?? null,
      shipment: latestShipment
        ? {
            courier: latestShipment.courier ?? latestShipment.courierProviderCode ?? null,
            status: latestShipment.status ?? null,
            trackingNumber: latestShipment.trackingNumber ?? null,
          }
        : null,
    };
  });

  return <FulfillmentClient orders={rows} />;
}
