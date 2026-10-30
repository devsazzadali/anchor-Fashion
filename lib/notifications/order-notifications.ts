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

/**
 * S3-4: order emails previously reported only via console.log — no DB
 * evidence a send was attempted, accepted or rejected. Mirror the SMS
 * audit trail (AlphaSmsService.recordSmsLog): one communication_logs row
 * per order-email outcome, including pre-send skips. Fail-safe by design —
 * a logging failure must never break the order flow, so this never throws.
 */
async function recordOrderEmailLog(entry: {
  event: string;
  orderId: string;
  orderNumber?: string | null;
  profileId?: string | null;
  recipients: string[];
  subject: string;
  status: "SENT" | "FAILED" | "SKIPPED";
  providerId?: string | null;
  reason?: string | null;
  error?: string | null;
}): Promise<void> {
  try {
    await prisma.communicationLog.create({
      data: {
        profileId: entry.profileId ?? null,
        type: "EMAIL",
        direction: "OUTBOUND",
        subject: entry.subject,
        content: `${entry.event} for order #${entry.orderNumber ?? entry.orderId} → ${
          entry.recipients.length > 0 ? entry.recipients.join(", ") : "(no recipient)"
        }`,
        status: entry.status,
        metadata: {
          channel: "email",
          provider: "RESEND",
          event: entry.event,
          order_id: entry.orderId,
          order_number: entry.orderNumber ?? null,
          recipients: entry.recipients,
          provider_id: entry.providerId ?? null,
          reason: entry.reason ?? null,
          error: entry.error
            ? String((entry.error as any)?.message || entry.error)
            : null,
        },
      },
    });
  } catch (err) {
    console.error(
      "[OrderNotifications] Failed to write email audit log:",
      err
    );
  }
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
  const event = "order_completion_invoice";
  let order: any = null;
  let to: string | null = null;
  let subject = "";
  try {
    order = await loadOrder(orderId);
    if (!order) {
      await recordOrderEmailLog({
        event,
        orderId,
        recipients: [],
        subject: "(order not found)",
        status: "SKIPPED",
        reason: "order_not_found",
      });
      return { sent: false, reason: "order_not_found" };
    }

    subject = `Your Anchor Fashion invoice — order #${order.orderNumber} delivered`;
    to = resolveCustomerEmail(order);
    if (!to) {
      console.warn(
        `[OrderNotifications] completion invoice skipped for ${order.orderNumber}: no customer email on order`
      );
      await recordOrderEmailLog({
        event,
        orderId,
        orderNumber: order.orderNumber,
        profileId: (order as any).profileId ?? null,
        recipients: [],
        subject,
        status: "SKIPPED",
        reason: "no_customer_email",
      });
      return { sent: false, reason: "no_customer_email" };
    }

    const res = await EmailProvider.send({
      to,
      subject,
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
      await recordOrderEmailLog({
        event,
        orderId,
        orderNumber: order.orderNumber,
        profileId: (order as any).profileId ?? null,
        recipients: [to],
        subject,
        status: "FAILED",
        reason: "provider_error",
        error: res.error,
      });
      return { sent: false, reason: "provider_error", error: res.error };
    }

    console.log(
      `[OrderNotifications] completion invoice sent order=${order.orderNumber} to=${to} id=${res.id}`
    );
    await recordOrderEmailLog({
      event,
      orderId,
      orderNumber: order.orderNumber,
      profileId: (order as any).profileId ?? null,
      recipients: [to],
      subject,
      status: "SENT",
      providerId: res.id ?? null,
    });
    return { sent: true, id: res.id, to };
  } catch (err: any) {
    console.error(
      "[OrderNotifications] completion invoice unexpected error:",
      err?.message || err
    );
    await recordOrderEmailLog({
      event,
      orderId,
      orderNumber: order?.orderNumber ?? null,
      profileId: (order as any)?.profileId ?? null,
      recipients: to ? [to] : [],
      subject: subject || "(not composed)",
      status: "FAILED",
      reason: "exception",
      error: err?.message || err,
    });
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
  const event = `staff_order_event:${opts.kind}`;
  let order: any = null;
  let recipients: string[] = [];
  let subject = "";
  try {
    order = await loadOrder(opts.orderId);
    if (!order) {
      await recordOrderEmailLog({
        event,
        orderId: opts.orderId,
        recipients: [],
        subject: "(order not found)",
        status: "SKIPPED",
        reason: "order_not_found",
      });
      return { sent: false, reason: "order_not_found" };
    }

    const staff = await prisma.profile.findMany({
      where: {
        isActive: true,
        email: { not: null },
        role: { name: { in: STAFF_NOTIFICATION_ROLES } },
      },
      select: { email: true },
    });
    recipients = Array.from(
      new Set(
        staff
          .map((s) => s.email?.trim())
          .filter((e): e is string => !!e && e.includes("@"))
      )
    );

    subject =
      opts.kind === "new_order"
        ? `New order #${order.orderNumber} — ৳${Number(order.totalAmount || 0).toLocaleString("en-IN")}`
        : `Order #${order.orderNumber} is now ${opts.status || order.status}`;

    if (recipients.length === 0) {
      console.warn(
        `[OrderNotifications] staff ${opts.kind} email skipped for ${order.orderNumber}: no staff recipients`
      );
      await recordOrderEmailLog({
        event,
        orderId: opts.orderId,
        orderNumber: order.orderNumber,
        recipients: [],
        subject,
        status: "SKIPPED",
        reason: "no_staff_recipients",
      });
      return { sent: false, reason: "no_staff_recipients" };
    }

    const res = await EmailProvider.send({
      to: recipients,
      subject,
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
      await recordOrderEmailLog({
        event,
        orderId: opts.orderId,
        orderNumber: order.orderNumber,
        recipients,
        subject,
        status: "FAILED",
        reason: "provider_error",
        error: res.error,
      });
      return { sent: false, reason: "provider_error", error: res.error };
    }

    console.log(
      `[OrderNotifications] staff ${opts.kind} email sent order=${order.orderNumber} recipients=${recipients.length} id=${res.id}`
    );
    await recordOrderEmailLog({
      event,
      orderId: opts.orderId,
      orderNumber: order.orderNumber,
      recipients,
      subject,
      status: "SENT",
      providerId: res.id ?? null,
    });
    return { sent: true, id: res.id, recipients: recipients.length };
  } catch (err: any) {
    console.error(
      "[OrderNotifications] staff event unexpected error:",
      err?.message || err
    );
    await recordOrderEmailLog({
      event,
      orderId: opts.orderId,
      orderNumber: order?.orderNumber ?? null,
      recipients,
      subject: subject || "(not composed)",
      status: "FAILED",
      reason: "exception",
      error: err?.message || err,
    });
    return { sent: false, reason: "exception", error: err?.message };
  }
}
