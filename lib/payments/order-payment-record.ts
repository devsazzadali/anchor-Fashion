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
