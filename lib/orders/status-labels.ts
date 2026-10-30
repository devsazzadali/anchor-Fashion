/**
 * REG-22: the ONE source for admin order-status display labels.
 *
 * The same order state used to be named three ways depending on the
 * surface — the orders LIST collapsed fine statuses into coarse
 * buckets ("Processing" for a PREPARING order) while the DETAIL header
 * showed the fine status ("Preparing"), and the delivered bucket was
 * "Completed" on the tabs but "Delivered" on the summary cards. Every
 * admin surface now resolves its label here:
 *
 *   · orderStatusLabel(status) — the fine-grained label, identical to
 *     what the detail header shows (the stored status, humanised).
 *   · ORDER_DELIVERED_LABEL — the single term for the delivered /
 *     completed bucket across tabs and cards. Both stored states
 *     (DELIVERED and COMPLETED) label as "Delivered".
 *
 * Display-layer only: stored statuses and tab filter logic are
 * untouched.
 */

const FINE_LABELS: Record<string, string> = {
  pending: "Pending",
  pending_payment: "Pending Payment",
  draft: "Draft",
  confirmed: "Confirmed",
  preparing: "Preparing",
  processing: "Processing",
  picking: "Picking",
  packing: "Packing",
  ready_for_shipment: "Ready for Shipment",
  shipped: "Shipped",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  completed: "Delivered",
  cancelled: "Cancelled",
  returned: "Returned",
  refund_requested: "Refund Requested",
  refunded: "Refunded",
};

export function orderStatusLabel(status: string | null | undefined): string {
  const key = String(status || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!key) return "—";
  return (
    FINE_LABELS[key] ??
    key
      .split("_")
      .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
      .join(" ")
  );
}

/** The one label for the delivered/completed bucket (tabs + cards). */
export const ORDER_DELIVERED_LABEL = "Delivered";
