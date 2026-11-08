import { OrderStatus } from "@/types/oms";

// Define valid transitions as a state machine
const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  draft: ["pending_payment", "cancelled"],
  pending_payment: ["payment_processing", "paid", "cancelled", "failed"],
  payment_processing: ["paid", "failed", "cancelled"],
  paid: ["confirmed", "cancelled", "refund_requested"],
  confirmed: ["preparing", "cancelled", "refund_requested"],
  preparing: ["picking", "cancelled"],
  picking: ["packing", "cancelled"],
  packing: ["ready_for_shipment"],
  ready_for_shipment: ["shipped"],
  shipped: ["out_for_delivery", "delivered", "returned"],
  out_for_delivery: ["delivered", "failed", "returned"],
  delivered: ["completed", "returned", "refund_requested"],
  completed: ["returned"],
  cancelled: [], // Terminal state
  refund_requested: ["refund_approved", "cancelled"], // Can cancel request
  refund_approved: ["refunded"],
  refunded: [], // Terminal
  returned: ["refund_requested"],
  failed: ["cancelled", "pending_payment"], // e.g. retry payment
};

/**
 * Legitimate staff CORRECTIONS on top of the forward lifecycle: undoing
 * an erroneous step (one step back), abandoning packing, and cancelling
 * from any state where the order has not yet reached the customer.
 * Anything else — e.g. cancelled → delivered, refunded → shipped — is a
 * nonsense jump and is rejected, because the side-effect bundles in the
 * order service (loyalty, inventory, SMS, email) fire on entry to a
 * state and must never fire for a transition that cannot really happen.
 */
const STAFF_CORRECTIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  packing: ["cancelled"],
  shipped: ["ready_for_shipment"],
  delivered: ["shipped"],
  completed: ["delivered"],
  // Dispatch compression: the forward-to-courier action (and the manual
  // fulfillment tracking assignment) perform the pick/pack work as part
  // of the dispatch itself, so an order in any pre-dispatch working
  // state may move straight to ready_for_shipment through them.
  paid: ["ready_for_shipment"],
  confirmed: ["ready_for_shipment"],
  preparing: ["ready_for_shipment"],
  picking: ["ready_for_shipment"],
};

/** States from which staff may cancel an order outright. Delivered /
 *  completed / returned orders are NOT here on purpose: those are undone
 *  through the returns and refund flows, not a bare cancellation. */
const STAFF_CANCELLABLE_FROM: OrderStatus[] = [
  "draft",
  "pending_payment",
  "payment_processing",
  "paid",
  "confirmed",
  "preparing",
  "picking",
  "packing",
  "ready_for_shipment",
  "shipped",
  "out_for_delivery",
  "refund_requested",
  "failed",
];

const TERMINAL_STATES: OrderStatus[] = ["cancelled", "refunded"];

export class OrderStatusService {
  /**
   * Validates if a transition from currentStatus to newStatus is allowed.
   *
   * Staff roles follow the same lifecycle as everyone else — being an
   * admin never licensed arbitrary jumps — plus the correction set
   * above. The webhook role follows the plain lifecycle (provider events
   * only ever move an order forward). Customers may only request
   * cancellation or a refund along the lifecycle.
   */
  canTransition(
    currentStatus: OrderStatus,
    newStatus: OrderStatus,
    role?: string
  ): boolean {
    const current = String(currentStatus || "").toLowerCase() as OrderStatus;
    const next = String(newStatus || "").toLowerCase() as OrderStatus;

    // Re-asserting the current state is an idempotent no-op (sync jobs
    // and webhook retries rely on it); it fires no new side effects.
    if (current === next) return true;

    const normalizedRole = (role || "").toLowerCase();
    const isStaff =
      normalizedRole === "super_admin" ||
      normalizedRole === "superadmin" ||
      normalizedRole === "admin" ||
      normalizedRole.includes("admin") ||
      normalizedRole === "manager" ||
      normalizedRole === "staff" ||
      normalizedRole === "warehouse_manager" ||
      normalizedRole === "operations" ||
      // Internal automation (fulfillment assignment) acts with staff
      // authority; courier webhooks ("webhook") deliberately do not.
      normalizedRole === "system";

    const allowed = VALID_TRANSITIONS[current];
    if (!allowed) return false;

    if (isStaff) {
      if (allowed.includes(next)) return true;
      if ((STAFF_CORRECTIONS[current] || []).includes(next)) return true;
      if (
        next === "cancelled" &&
        STAFF_CANCELLABLE_FROM.includes(current) &&
        !TERMINAL_STATES.includes(current)
      ) {
        return true;
      }
      return false;
    }

    // Customers can ONLY initiate cancellation or refund requests, and
    // only along the lifecycle.
    if (normalizedRole === "customer" || normalizedRole === "user") {
      const customerAllowedTargets = ["cancelled", "refund_requested"];
      if (!customerAllowedTargets.includes(next)) {
        return false;
      }
    }

    return allowed.includes(next);
  }

  /**
   * Retrieves the allowed next states for a given status.
   */
  getAllowedNextStates(currentStatus: OrderStatus): OrderStatus[] {
    return VALID_TRANSITIONS[currentStatus] || [];
  }
}
