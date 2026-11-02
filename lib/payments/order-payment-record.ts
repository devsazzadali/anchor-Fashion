import { prisma } from "@/lib/prisma";

/**
 * S6-7: the Finance → Transactions page was permanently empty because
 * BOTH sides of the ledger were broken:
 *   · the page read a `payment_transactions` table that does not exist
 *     in this schema (the polyfill resolved it to an empty result), and
 *   · no order flow ever wrote a payment row — the real `payments`
 *     table held only 5 legacy POS rows.
 *
 * These helpers are the write side, on the real schema: a payment row
 * is recorded when an order is placed (PENDING while the order is
 * unpaid; SUCCESS immediately for an order placed already-PAID), and
 * flipped to SUCCESS when the order's payment_status becomes PAID.
 * Recording is idempotent per order — the first row wins, so retries
 * and multi-path placements never duplicate the ledger.
 */
export async function recordOrderPayment(args: {
  orderId: string;
  amount: number;
  method?: string | null;
  paymentStatus?: string | null;
}): Promise<void> {
  const existing = await prisma.payment.findFirst({
    where: { orderId: args.orderId },
    select: { id: true },
  });
  if (existing) return;

  const paid = String(args.paymentStatus || "").toUpperCase() === "PAID";
  await prisma.payment.create({
    data: {
      orderId: args.orderId,
      amount: args.amount,
      method: (args.method || "COD").toUpperCase(),
      status: paid ? "SUCCESS" : "PENDING",
    },
  });
}

/** Flip an order's pending payment row(s) to SUCCESS (payment received). */
export async function markOrderPaymentSuccess(orderId: string): Promise<void> {
  await prisma.payment.updateMany({
    where: { orderId, status: "PENDING" },
    data: { status: "SUCCESS" },
  });
}

/* ------------------------------------------------------------------ */
/* FIX ROUND 28 (M-2): the `payment_transactions` table does not exist  */
/* in this schema — every write to it was silently discarded by the    */
/* row builder, and every read resolved empty. The real ledger is      */
/* `payments` (id, order_id, amount, method, status, transaction_id,  */
/* gateway_response, created_at, updated_at). The helpers below are    */
/* the single convention for writing/reading gateway + manual-payment  */
/* records on that table through the fluent builder:                   */
/*   · status vocabulary on the table: SUCCESS / PENDING / FAILED      */
/*     (legacy POS rows use COMPLETED; readers treat both as paid).    */
/*   · everything the old phantom table carried as columns that has    */
/*     no real column (session_id, provider_id, user_id, currency,     */
/*     reference_number, error_code, error_message) lives inside       */
/*     gateway_response, with the raw gateway payload under            */
/*     gateway_response.gateway_payload.                               */
/* ------------------------------------------------------------------ */

export function paymentStatusToLegacy(status: string | null | undefined): string {
  const s = String(status || "").toUpperCase();
  if (s === "SUCCESS" || s === "COMPLETED") return "completed";
  if (s === "FAILED") return "failed";
  if (s === "PENDING") return "pending";
  return String(status || "").toLowerCase();
}

export function legacyStatusToPaymentStatus(status: string | null | undefined): string {
  const s = String(status || "").toLowerCase();
  if (s === "completed" || s === "success" || s === "paid") return "SUCCESS";
  if (s === "failed" || s === "cancelled" || s === "canceled") return "FAILED";
  return "PENDING";
}

/** Map a real `payments` row back to the legacy payment_transactions shape. */
export function paymentRowToLegacyTransaction(row: any): any {
  if (!row) return row;
  const gw = (row.gateway_response || {}) as Record<string, any>;
  return {
    id: row.id,
    order_id: row.order_id,
    method: row.method ?? null,
    session_id: gw.session_id ?? null,
    provider_id: gw.provider_id ?? null,
    user_id: gw.user_id ?? null,
    amount: row.amount,
    currency: gw.currency ?? "BDT",
    status: paymentStatusToLegacy(row.status),
    reference_number: gw.reference_number ?? null,
    gateway_transaction_id: row.transaction_id ?? null,
    gateway_response: gw.gateway_payload ?? gw,
    error_code: gw.error_code ?? null,
    error_message: gw.error_message ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export interface GatewayTransactionArgs {
  orderId: string;
  amount: number;
  method: string;
  status: "SUCCESS" | "FAILED" | "PENDING";
  sessionId?: string | null;
  providerId?: string | null;
  userId?: string | null;
  currency?: string;
  referenceNumber?: string | null;
  gatewayTransactionId?: string | null;
  gatewayResponse?: any;
  errorCode?: string | null;
  errorMessage?: string | null;
  extraMeta?: Record<string, any>;
}

/**
 * Record a gateway/manual transaction on the real `payments` ledger via
 * the fluent builder. Idempotent per (order_id, transaction_id): a
 * repeated callback for the same gateway transaction does not create a
 * second row. Returns true when a row exists/was written; on failure it
 * logs a durable server error (never drops silently) and returns false.
 */
export async function recordGatewayTransaction(
  db: any,
  args: GatewayTransactionArgs
): Promise<boolean> {
  try {
    if (args.gatewayTransactionId) {
      const { data: existing } = await db
        .from("payments")
        .select("id")
        .eq("order_id", args.orderId)
        .eq("transaction_id", args.gatewayTransactionId)
        .limit(1);
      if (existing && existing.length > 0) return true;
    }
    const { data, error } = await db.from("payments").insert({
      order_id: args.orderId,
      amount: args.amount,
      method: args.method,
      status: args.status,
      transaction_id: args.gatewayTransactionId ?? null,
      gateway_response: {
        gateway_payload: args.gatewayResponse ?? null,
        session_id: args.sessionId ?? null,
        provider_id: args.providerId ?? null,
        user_id: args.userId ?? null,
        currency: args.currency ?? "BDT",
        reference_number: args.referenceNumber ?? null,
        error_code: args.errorCode ?? null,
        error_message: args.errorMessage ?? null,
        ...(args.extraMeta || {}),
      },
    });
    if (error || !data || (Array.isArray(data) && data.length === 0)) {
      console.error(
        `[payments-ledger] FAILED to record ${args.method} transaction for order ${args.orderId} ` +
          `(trx ${args.gatewayTransactionId ?? "n/a"}, status ${args.status}): ` +
          (error?.message || "write returned no row")
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      `[payments-ledger] EXCEPTION recording ${args.method} transaction for order ${args.orderId}: ` +
        ((err as Error)?.message || String(err))
    );
    return false;
  }
}

/**
 * REG-18: guarantee a SUCCESS payment row exists for an order that has
 * just become PAID. markOrderPaymentSuccess alone only flips rows that
 * already exist — orders placed before the round-8 writer existed (or
 * through any path that never recorded a placement row) reached PAID
 * with NO ledger row at all, so Finance → Transactions silently omitted
 * money that was actually collected (proven live: AF-20261029-2FOZ
 * delivered + PAID with 0 payment rows). Idempotent: an existing row is
 * flipped PENDING → SUCCESS and otherwise left untouched; a missing row
 * is created with the order's total + method and a null transaction id.
 * Status vocabulary matches the Transactions page (SUCCESS renders as
 * paid alongside the legacy POS COMPLETED rows).
 */
export async function ensureOrderPaymentSuccess(args: {
  orderId: string;
  amount: number;
  method?: string | null;
}): Promise<void> {
  const existing = await prisma.payment.findFirst({
    where: { orderId: args.orderId },
    select: { id: true, status: true },
    orderBy: { createdAt: "asc" },
  });
  if (!existing) {
    await prisma.payment.create({
      data: {
        orderId: args.orderId,
        amount: args.amount,
        method: (args.method || "COD").toUpperCase(),
        status: "SUCCESS",
        transactionId: null,
      },
    });
    return;
  }
  if (String(existing.status || "").toUpperCase() === "PENDING") {
    await prisma.payment.update({
      where: { id: existing.id },
      data: { status: "SUCCESS" },
    });
  }
}
