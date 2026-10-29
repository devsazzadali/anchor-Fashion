"use server";

import { revalidatePath } from "next/cache";
import { AlphaSmsService } from "@/lib/services/sms/alpha-sms.service";
import { verifyStaff } from "@/lib/security/roles";
import { SmsLog } from "@/types/sms.types";

/**
 * Fetch all SMS logs for a specific order (Admin/Staff only)
 */
export async function getOrderSmsLogsAction(
  orderId: string
): Promise<{ success: boolean; logs: SmsLog[]; error?: string }> {
  try {
    // Staff only: SMS logs contain customer phone numbers and message
    // bodies for ANY order. Previously any signed-in customer could read
    // them by guessing an order id, despite the "Admin/Staff only" label.
    await verifyStaff();

    const logs = await AlphaSmsService.getOrderSmsLogs(orderId);
    return { success: true, logs };
  } catch (err: any) {
    console.error("Error in getOrderSmsLogsAction:", err);
    return { success: false, logs: [], error: err.message };
  }
}

/**
 * Resend order confirmation SMS (Admin only)
 * Bypasses previous duplicate lock via force: true, but strictly enforces order.status === 'confirmed'.
 */
export async function resendOrderConfirmationSmsAction(
  orderId: string
): Promise<{ success: boolean; error?: string; requestId?: string | null }> {
  try {
    // Admin/staff only: force-resending an order SMS costs money and can
    // spam the customer; a plain authenticated session is not enough.
    await verifyStaff();

    const result = await AlphaSmsService.sendOrderConfirmationSMS(orderId, {
      force: true,
    });

    if (!result.success) {
      return {
        success: false,
        error: result.error || result.reason || "Failed to send SMS.",
      };
    }

    revalidatePath(`/admin/orders/${orderId}`);
    return { success: true, requestId: result.requestId };
  } catch (err: any) {
    console.error("Error in resendOrderConfirmationSmsAction:", err);
    return { success: false, error: err.message || "Failed to dispatch SMS" };
  }
}
