import {
  sendNotificationAction,
  generateAiContentAction,
  alertAdminAction,
} from "./actions";

export type WorkflowTrigger =
  | "user.registered"
  | "order.created"
  | "order.shipped"
  | "stock.low"
  | "cart.abandoned"
  | "review.requested";

/**
 * Fields a workflow action reads off its trigger payload. The three
 * rules below each read a subset; userId, productName and sku are
 * required because the welcome/stock-low actions pass them straight
 * into string-typed action arguments.
 */
export interface WorkflowActionPayload {
  userId: string;
  firstName?: string;
  productName: string;
  sku: string;
  quantity?: string | number;
  orderId?: string;
  totalAmount?: string | number;
}

type ActionFunction = (
  payload: WorkflowActionPayload,
  config?: Record<string, unknown>
) => Promise<void>;

/**
 * Enterprise Automation Rules Map
 * Maps standard triggers to a sequence of action functions.
 */
export const automationRules: Record<string, ActionFunction[]> = {
  "user.registered": [
    async (payload) => {
      // 1. Send Welcome Email
      await sendNotificationAction(payload.userId, "welcome_email", {
        firstName: payload.firstName,
      });
    },
  ],
  "stock.low": [
    async (payload) => {
      // 1. Alert Manager
      await alertAdminAction(
        "Low Stock Alert",
        `Product ${payload.productName} (SKU: ${payload.sku}) is running low on stock. Only ${payload.quantity} left.`
      );
      // 2. Generate a reorder draft using AI
      const aiResponse = await generateAiContentAction(
        "generate_reorder_email",
        {
          productName: payload.productName,
          sku: payload.sku,
          quantityNeeded: "100", // Example logic
        }
      );
    },
  ],
  "order.created": [
    async (payload) => {
      await sendNotificationAction(payload.userId, "order_confirmation", {
        orderId: payload.orderId,
        totalAmount: payload.totalAmount,
      });
    },
  ],
  // Add more predefined workflows as needed
};
