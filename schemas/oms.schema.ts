import { z } from "zod";

export const orderStatusSchema = z.enum([
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
  "delivered",
  "completed",
  "cancelled",
  "refund_requested",
  "refund_approved",
  "refunded",
  "returned",
  "failed",
]);

// Phase 11: the staff-side createOrderSchema was removed together with
// staff order creation — Anchor Fashion has no manual sales; orders are
// created only by customers through the storefront checkout.

export const updateOrderStatusSchema = z.object({
  order_id: z.string().uuid(),
  new_status: orderStatusSchema,
  reason: z.string().optional(),
});

export const addOrderNoteSchema = z.object({
  order_id: z.string().uuid(),
  note: z.string().min(1, "Note cannot be empty"),
  is_customer_visible: z.boolean().default(false),
});

export const assignOrderStaffSchema = z.object({
  order_id: z.string().uuid(),
  assignee_id: z.string().uuid(),
  role: z.string().min(1),
});

export const fulfillShipmentSchema = z.object({
  order_id: z.string().uuid(),
  tracking_number: z.string().min(1),
  courier: z.string().min(1),
});

export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
export type AddOrderNoteInput = z.infer<typeof addOrderNoteSchema>;
export type AssignOrderStaffInput = z.infer<typeof assignOrderStaffSchema>;
export type FulfillShipmentInput = z.infer<typeof fulfillShipmentSchema>;
