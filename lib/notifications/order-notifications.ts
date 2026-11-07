/**
 * Order lifecycle email notifications (Phase 8).
 *
 * Two automations live here:
 *  1. Customer invoice email when an order reaches a completed state
 *     (DELIVERED / COMPLETED) — previously missing entirely: the only
 *     customer email was the "Order Confirmed" message at CONFIRMED.
 *  2. Staff notification emails (ADMIN / SUPERADMIN / MANAGER profiles)
 *     on order events — new order placed and every status change.
 *     Previously only the in-app bell notification existed.
 *
 * Every function is fail-safe: a notification problem must never break
 * the order flow, so all errors are caught and logged, never thrown.
 */

import { prisma } from "@/lib/prisma";
import { EmailProvider } from "./EmailProvider";
import { EmailTemplates } from "./EmailTemplates";
import { getInvoiceInfo } from "@/lib/actions/settings.actions";

const STAFF_NOTIFICATION_ROLES = ["ADMIN", "SUPERADMIN", "MANAGER"];

function storeUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://anchor.com.bd";
}

function customerNameFrom(order: any): string | null {
  const addr = (order.shippingAddress || {}) as Record<string, any>;
  const fromAddr = [addr.first_name, addr.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (fromAddr) return fromAddr;
  if (order.profile) {
    const n = [order.profile.firstName, order.profile.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();
    if (n) return n;
  }
  return order.customer?.name || null;
}

/** Resolve the best customer email for an order (profile → shipping JSON → customer record). */
function resolveCustomerEmail(order: any): string | null {
  const candidates = [
    order.profile?.email,
    (order.shippingAddress as any)?.email,
    order.customer?.email,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.includes("@")) return c.trim();
  }
  return null;
}

async function loadOrder(orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      profile: { select: { email: true, firstName: true, lastName: true } },
      customer: { select: { email: true, name: true } },
    },
  });
}

function toTemplateOrder(order: any) {
  return {
    id: order.id,
    invoice_token: order.invoiceToken || null,
    order_number: order.orderNumber,
    customer_name: customerNameFrom(order),
    payment_method: order.paymentMethod,
    payment_status: order.paymentStatus,
    subtotal: Number(order.subtotal || 0),
    discount_amount: Number(order.discount || 0),
    shipping_cost: Number(order.shippingFee || 0),
    vat_amount: Number(order.vatAmount || 0),
    total_amount: Number(order.totalAmount || 0),
    order_items: (order.items || []).map((i: any) => ({
      product_name: i.productName,
      variant_sku: i.sku,
      quantity: i.quantity,
      unit_price: Number(i.unitPrice || 0),
    })),
  };
}

/**
 * Email the customer their invoice when the order completes.
 * Returns a small result object for logging/tests; never throws.
 */
export async function sendOrderCompletionInvoiceEmail(orderId: string) {
  try {
    const order = await loadOrder(orderId);
    if (!order) return { sent: false, reason: "order_not_found" };

    const to = resolveCustomerEmail(order);
    if (!to) {
      console.warn(
        `[OrderNotifications] completion invoice skipped for ${order.orderNumber}: no customer email on order`
      );
      return { sent: false, reason: "no_customer_email" };
    }

    const res = await EmailProvider.send({
      to,
      subject: `Your Anchor Fashion invoice — order #${order.orderNumber} delivered`,
      html: EmailTemplates.orderDeliveredInvoice(
        toTemplateOrder(order),
        storeUrl(),
        await getInvoiceInfo().catch(() => undefined)
      ),
    });

    if (res.error) {
      console.error(
        `[OrderNotifications] completion invoice FAILED for ${order.orderNumber}:`,
        res.error
      );
      return { sent: false, reason: "provider_error", error: res.error };
    }

    console.log(
      `[OrderNotifications] completion invoice sent order=${order.orderNumber} to=${to} id=${res.id}`
    );
    return { sent: true, id: res.id, to };
  } catch (err: any) {
    console.error(
      "[OrderNotifications] completion invoice unexpected error:",
      err?.message || err
    );
    return { sent: false, reason: "exception", error: err?.message };
  }
}

/**
 * Email all active ADMIN / SUPERADMIN / MANAGER profiles about an order
 * event. One message addressed to every staff recipient. Never throws.
 */
export async function notifyStaffOrderEvent(opts: {
  kind: "new_order" | "status_change";
  orderId: string;
  status?: string;
  previousStatus?: string | null;
}) {
  try {
    const order = await loadOrder(opts.orderId);
    if (!order) return { sent: false, reason: "order_not_found" };

    const staff = await prisma.profile.findMany({
      where: {
        isActive: true,
        email: { not: null },
        role: { name: { in: STAFF_NOTIFICATION_ROLES } },
      },
      select: { email: true },
    });
    const recipients = Array.from(
      new Set(
        staff
          .map((s) => s.email?.trim())
          .filter((e): e is string => !!e && e.includes("@"))
      )
    );

    if (recipients.length === 0) {
      console.warn(
        `[OrderNotifications] staff ${opts.kind} email skipped for ${order.orderNumber}: no staff recipients`
      );
      return { sent: false, reason: "no_staff_recipients" };
    }

    const res = await EmailProvider.send({
      to: recipients,
      subject:
        opts.kind === "new_order"
          ? `New order #${order.orderNumber} — ৳${Number(order.totalAmount || 0).toLocaleString("en-IN")}`
          : `Order #${order.orderNumber} is now ${opts.status || order.status}`,
      html: EmailTemplates.staffOrderEvent({
        kind: opts.kind,
        orderNumber: order.orderNumber,
        orderId: order.id,
        status: opts.status || order.status,
        previousStatus: opts.previousStatus ?? null,
        totalAmount: Number(order.totalAmount || 0),
        paymentMethod: order.paymentMethod,
        customerName: customerNameFrom(order),
        adminUrl: `${storeUrl()}/admin/orders/${order.id}`,
      }),
    });

    if (res.error) {
      console.error(
        `[OrderNotifications] staff ${opts.kind} email FAILED for ${order.orderNumber}:`,
        res.error
      );
      return { sent: false, reason: "provider_error", error: res.error };
    }

    console.log(
      `[OrderNotifications] staff ${opts.kind} email sent order=${order.orderNumber} recipients=${recipients.length} id=${res.id}`
    );
    return { sent: true, id: res.id, recipients: recipients.length };
  } catch (err: any) {
    console.error(
      "[OrderNotifications] staff event unexpected error:",
      err?.message || err
    );
    return { sent: false, reason: "exception", error: err?.message };
  }
}
