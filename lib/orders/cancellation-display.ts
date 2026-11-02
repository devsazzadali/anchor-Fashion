// ============================================================================
// Cancellation display derivation — FIX ROUND 25
//
// The orders table has NO cancellation_reason / cancellation_note columns
// (verified against prisma/schema.prisma and the production
// information_schema). The customer order page previously read those
// phantom fields, so its Cancellation Details panel always showed
// "Reason: Not specified" and — because the cancel path also never
// stamped the real cancelled_at column — "Cancelled At: Unknown".
//
// Where the facts actually live:
//   * orders.cancelled_at — a real column, stamped by
//     cancelCustomerOrderAction and by OrderRepository.updateOrderStatus
//     (both since FIX ROUND 25).
//   * order_status_history — the customer cancel action records the
//     chosen reason (and optional note) in the CANCELLED row's notes as
//     "Reason" or "Reason: note". That row's created_at is also the
//     fallback timestamp for cancellations made before cancelled_at
//     stamping existed, so historical orders display correctly with no
//     data migration.
//
// The staff status-update path writes boilerplate history notes
// ("Order status updated to CANCELLED (by …)") — that is not a customer
// cancellation reason and is never presented as one.
// ============================================================================

export interface CancellationDisplay {
  reason: string | null;
  note: string | null;
  cancelledAt: string | null;
}

/**
 * The cancellation reason list, shared by the customer cancel dialog
 * and the admin cancel dialog (FIX ROUND 29, D8) so both sides offer —
 * and store — exactly the same reasons.
 */
export const CANCELLATION_REASONS = [
  "Changed my mind",
  "Ordered by mistake",
  "Found a better price",
  "Wrong size/item selected",
  "Delivery taking too long",
  "Payment issue",
  "Duplicate order",
  "Other",
] as const;

interface CancellationHistoryRow {
  status?: string | null;
  new_status?: string | null;
  notes?: string | null;
  reason?: string | null;
  created_at?: string | Date | null;
}

export function deriveCancellationDisplay(order: {
  cancelled_at?: string | Date | null;
  order_status_history?: CancellationHistoryRow[] | null;
}): CancellationDisplay {
  const history = order.order_status_history ?? [];
  const cancelRow = [...history]
    .filter(
      (h) =>
        String(h.status || h.new_status || "").toUpperCase() === "CANCELLED"
    )
    .sort(
      (a, b) =>
        new Date(b.created_at ?? 0).getTime() -
        new Date(a.created_at ?? 0).getTime()
    )[0];

  let reason: string | null = null;
  let note: string | null = null;
  const raw = (cancelRow?.notes || cancelRow?.reason || "").trim();
  if (raw && !raw.startsWith("Order status updated to")) {
    const sep = raw.indexOf(": ");
    if (sep > 0) {
      reason = raw.slice(0, sep);
      note = raw.slice(sep + 2).trim() || null;
    } else {
      reason = raw;
    }
  }

  const cancelledAt = order.cancelled_at
    ? new Date(order.cancelled_at).toISOString()
    : cancelRow?.created_at
      ? new Date(cancelRow.created_at).toISOString()
      : null;

  return { reason, note, cancelledAt };
}
