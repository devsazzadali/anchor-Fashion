import { createAdminDbClient } from "@/lib/db/client";
import {
  SmsLog,
  SmsSendResult,
  SendSmsOptions,
  AlphaSmsApiResponse,
} from "@/types/sms.types";

const ALPHA_SMS_ENDPOINT = "https://api.sms.net.bd/sendsms";
const BRAND_NAME = "Anchor Fashion";

export class AlphaSmsService {
  /**
   * Normalize a phone number to standard Bangladesh format: 8801XXXXXXXXX (13 digits)
   * Strips spaces, hyphens, plus signs, parentheses.
   */
  static normalizePhoneNumber(rawPhone: string): {
    valid: boolean;
    normalized: string;
    reason?: string;
  } {
    if (!rawPhone || typeof rawPhone !== "string") {
      return { valid: false, normalized: "", reason: "Phone number is empty or not a string." };
    }

    // Remove all non-digit characters except leading '+'
    let cleaned = rawPhone.trim().replace(/[\s\-\(\)\.]/g, "");
    if (cleaned.startsWith("+")) {
      cleaned = cleaned.substring(1);
    }

    // Convert local format 01XXXXXXXXX (11 digits) to 8801XXXXXXXXX (13 digits)
    if (/^01[3-9]\d{8}$/.test(cleaned)) {
      cleaned = "88" + cleaned;
    }

    // Check if valid Bangladeshi mobile format (88013 - 88019, 13 digits)
    const isValidBdMobile = /^8801[3-9]\d{8}$/.test(cleaned);

    if (!isValidBdMobile) {
      return {
        valid: false,
        normalized: cleaned,
        reason: `Invalid Bangladeshi mobile number: ${rawPhone}. Expected format 01XXXXXXXXX or 8801XXXXXXXXX (11 or 13 digits).`,
      };
    }

    return { valid: true, normalized: cleaned };
  }

  /**
   * Send a single SMS via Alpha SMS REST API
   * Handles normalization, test mode, timeout, provider errors, and database logging.
   */
  static async sendSMS(options: SendSmsOptions): Promise<SmsSendResult> {
    const { to, message, orderId, type = "ORDER_CONFIRMATION" } = options;

    // 1. Phone number normalization & validation
    const { valid, normalized, reason } = this.normalizePhoneNumber(to);
    if (!valid) {
      await this.recordSmsLog({
        order_id: orderId || null,
        phone: normalized || to,
        message,
        type,
        status: "FAILED",
        provider: "ALPHA_SMS",
        error_message: reason || "Invalid phone number format",
      });

      return {
        success: false,
        status: "FAILED",
        phone: to,
        message,
        error: reason,
      };
    }

    const apiKey = process.env.ALPHA_SMS_API_KEY || "";
    const isSmsEnabled = process.env.SMS_ENABLED !== "false";
    const isTestMode =
      process.env.SMS_TEST_MODE === "true" ||
      !apiKey ||
      apiKey === "your_alpha_sms_api_key" ||
      apiKey.includes("your_");

    // 2. Check if SMS sending is disabled globally
    if (!isSmsEnabled) {
      return {
        success: true,
        status: "SKIPPED",
        phone: normalized,
        message,
        skipped: true,
        reason: "SMS sending is disabled via SMS_ENABLED=false.",
      };
    }

    // 3. Test Mode / Simulated Send (does not consume SMS credits)
    if (isTestMode) {
      const mockRequestId = `TEST-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

      const log = await this.recordSmsLog({
        order_id: orderId || null,
        phone: normalized,
        message,
        type,
        status: "SENT",
        provider: "ALPHA_SMS",
        request_id: mockRequestId,
        response: {
          test_mode: true,
          mock: true,
          error: 0,
          msg: "Success (Test Mode Simulated)",
          data: { request_id: mockRequestId },
        },
      });

      return {
        success: true,
        status: "SENT",
        phone: normalized,
        message,
        requestId: mockRequestId,
        isTestMode: true,
        logId: log?.id,
      };
    }

    // 4. Live Alpha SMS REST API Call
    try {
      const params = new URLSearchParams();
      params.append("api_key", apiKey);
      params.append("msg", message);
      params.append("to", normalized);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000); // 12-second timeout

      const response = await fetch(ALPHA_SMS_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const responseText = await response.text();
      let responseData: AlphaSmsApiResponse;

      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = { error: -1, msg: responseText };
      }

      const isSuccess = response.ok && responseData.error === 0;
      const requestId =
        responseData.data?.request_id !== undefined
          ? String(responseData.data.request_id)
          : responseData.request_id !== undefined
          ? String(responseData.request_id)
          : null;

      const errorMessage = isSuccess
        ? null
        : responseData.msg ||
          `Alpha SMS API error (code: ${responseData.error}, HTTP ${response.status})`;

      // 5. Audit Log to Database
      const log = await this.recordSmsLog({
        order_id: orderId || null,
        phone: normalized,
        message,
        type,
        status: isSuccess ? "SENT" : "FAILED",
        provider: "ALPHA_SMS",
        request_id: requestId,
        response: responseData,
        error_message: errorMessage,
      });

      if (!isSuccess) {
        return {
          success: false,
          status: "FAILED",
          phone: normalized,
          message,
          requestId,
          error: errorMessage,
          logId: log?.id,
        };
      }


      return {
        success: true,
        status: "SENT",
        phone: normalized,
        message,
        requestId,
        logId: log?.id,
      };
    } catch (error: any) {
      const isTimeout = error.name === "AbortError";
      const errReason = isTimeout
        ? "Request timeout after 12s connecting to Alpha SMS"
        : error.message || "Network connection error";


      const log = await this.recordSmsLog({
        order_id: orderId || null,
        phone: normalized,
        message,
        type,
        status: "FAILED",
        provider: "ALPHA_SMS",
        error_message: errReason,
      });

      return {
        success: false,
        status: "FAILED",
        phone: normalized,
        message,
        error: errReason,
        logId: log?.id,
      };
    }
  }

  /**
   * Send order confirmation SMS
   * STRICT GUARANTEES:
   * 1. ONLY orders with status == 'confirmed' (case-insensitive) can send.
   * 2. Checks order.confirmation_sms_sent to prevent duplicate messages.
   * 3. Dynamically extracts customer name, order number, and phone number.
   * 4. Updates order.confirmation_sms_sent = true upon success.
   * 5. Never throws an exception to caller (safe for fire-and-forget).
   */
  static async sendOrderConfirmationSMS(
    orderId: string,
    options?: { force?: boolean }
  ): Promise<SmsSendResult> {
    try {
      const db = await createAdminDbClient();

      // 1. Fetch order details
      const { data: order, error: orderErr } = await db
        .from("orders")
        .select("*")
        .eq("id", orderId)
        .maybeSingle();

      if (orderErr || !order) {
        const msg = `Order not found with ID: ${orderId} (${orderErr?.message || "No order record"})`;
        return {
          success: false,
          status: "FAILED",
          phone: "",
          message: "",
          error: msg,
        };
      }

      // FIX ROUND 28 (M-2): the order_addresses table does not exist in
      // this schema — the fetch below always resolved empty. The
      // address lives in the order's shipping_address JSON (extracted
      // in step 4); `addresses` stays as an always-empty list so the
      // downstream find() simply falls through to the JSON.

      // 2. Strict Confirmation Guard
      const currentStatus = (order.status || "").toLowerCase();
      if (currentStatus !== "confirmed") {
        const msg = `Order ${order.order_number} is in status '${order.status}', NOT 'CONFIRMED'. SMS aborted.`;
        return {
          success: false,
          status: "SKIPPED",
          phone: "",
          message: "",
          skipped: true,
          reason: msg,
        };
      }

      // 3. Duplicate SMS Protection
      if (!options?.force && order.confirmation_sms_sent === true) {
        const msg = `Confirmation SMS already sent for order ${order.order_number} (confirmation_sms_sent = true). Skipping duplicate.`;
        return {
          success: true,
          status: "SKIPPED",
          phone: "",
          message: "",
          skipped: true,
          reason: msg,
        };
      }

      // Also check if an active successful confirmation SMS was already recorded for this order
      if (!options?.force) {
        const priorSentLog = await this.checkPriorSentLog(order.id);
        if (priorSentLog) {
          const msg = `Confirmation SMS already logged as SENT for order ${order.order_number}. Skipping duplicate.`;
          // Sync confirmation_sms_sent flag
          await this.markOrderSmsSent(order.id);
          return {
            success: true,
            status: "SKIPPED",
            phone: priorSentLog.phone,
            message: priorSentLog.message,
            requestId: priorSentLog.request_id,
            skipped: true,
            reason: msg,
          };
        }
      }

      // 4. Extract Customer Name and Phone Number.
      // The address lives in the order's shipping_address JSON (there
      // are no order_addresses rows — see the Round-28 note above);
      // shippingAddr is that JSON, normalized for the reads below.
      const shippingJson = ((order as any).shipping_address || {}) as any;
      const shippingAddr = Object.keys(shippingJson).length
        ? shippingJson
        : null;
      let phone =
        shippingAddr?.phone ||
        (order as any).phone ||
        (order as any).customer_phone ||
        shippingJson.phone ||
        shippingJson.phone_number ||
        "";

      // Fallback: Check customers/profiles table if phone is missing in address
      if (!phone && order.customer_id) {
        try {
          const { data: profile } = await db
            .from("profiles")
            .select("phone, first_name, last_name")
            .eq("id", order.customer_id)
            .maybeSingle();
          if (profile?.phone) phone = profile.phone;
        } catch {
          // Ignored
        }
      }

      if (!phone) {
        const msg = `No phone number found for order ${order.order_number}. Cannot send confirmation SMS.`;
        await this.recordSmsLog({
          order_id: order.id,
          phone: "UNKNOWN",
          message: "",
          type: "ORDER_CONFIRMATION",
          status: "FAILED",
          provider: "ALPHA_SMS",
          error_message: msg,
        });

        return {
          success: false,
          status: "FAILED",
          phone: "",
          message: "",
          error: msg,
        };
      }

      const firstName =
        shippingAddr?.first_name?.trim() || shippingJson.first_name?.trim() || "";
      const lastName =
        shippingAddr?.last_name?.trim() || shippingJson.last_name?.trim() || "";
      let customerName = [firstName, lastName].filter(Boolean).join(" ");
      if (!customerName && order.customer_id) {
        try {
          const { data: profile } = await db
            .from("profiles")
            .select("first_name, last_name")
            .eq("id", order.customer_id)
            .maybeSingle();
          if (profile) {
            customerName = [profile.first_name, profile.last_name].filter(Boolean).join(" ");
          }
        } catch {
          // Ignored
        }
      }
      if (!customerName) customerName = "Valued Customer";
      const orderNumber = order.order_number || order.id.slice(0, 8);

      // Fetch order items to include in SMS
      let orderItems: Array<{ product_name?: string; quantity?: number }> = [];
      try {
        const { data: itemsList } = await db
          .from("order_items")
          .select("product_name, quantity")
          .eq("order_id", order.id);
        if (itemsList && itemsList.length > 0) {
          orderItems = itemsList;
        }
      } catch (itemErr) {
      }

      // 5. Construct Order Confirmation SMS Content with full professional details
      const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://anchorfashion.com").replace(/\/+$/, "");
      // Phase 12: the SMS carries the PUBLIC invoice link (unguessable
      // per-order token, view-only page, no login wall). The old
      // /account/orders/... link bounced guests to the login page.
      const invoiceUrl = (order as any).invoice_token
        ? `${appUrl}/invoice/${(order as any).invoice_token}`
        : `${appUrl}/account/orders/${order.id}/invoice`;

      const message = this.formatOrderConfirmationMessage({
        customerName,
        orderNumber,
        totalAmount: order.grand_total ?? order.total_amount,
        paymentMethod: order.payment_method,
        deliveryAddress: shippingAddr?.address_line_1,
        city: shippingAddr?.city,
        items: orderItems,
        invoiceUrl,
      });

      // 6. Dispatch SMS
      const result = await this.sendSMS({
        to: phone,
        message,
        orderId: order.id,
        type: "ORDER_CONFIRMATION",
      });

      // 7. Update order confirmation_sms_sent on success
      if (result.success && result.status === "SENT") {
        await this.markOrderSmsSent(order.id);

        // Add note to order_notes for transparent audit visibility
        try {
          await db.from("order_notes").insert({
            order_id: order.id,
            note: `[SMS Notification] Confirmation SMS sent to ${result.phone} via Alpha SMS (Request ID: ${result.requestId || "N/A"})`,
            is_customer_visible: false,
          });
        } catch {
          // Ignored
        }
      }

      return result;
    } catch (err) {
      return {
        success: false,
        status: "FAILED",
        phone: "",
        message: "",
        error: (err as Error).message || "Unknown error during order confirmation SMS dispatch",
      };
    }
  }

  /**
   * Formats a professional, highly detailed order confirmation message.
   * Includes Customer Name, Order Number, Items summary, Total Amount, Payment Method, Delivery Address, and Brand Name.
   */
  static formatOrderConfirmationMessage(details: {
    customerName: string;
    orderNumber: string;
    totalAmount?: number | string | null;
    paymentMethod?: string | null;
    deliveryAddress?: string | null;
    city?: string | null;
    items?: Array<{ name?: string; product_name?: string; quantity?: number }> | null;
    brandName?: string;
    invoiceUrl?: string | null;
  }): string {
    const {
      customerName,
      orderNumber,
      totalAmount,
      paymentMethod,
      deliveryAddress,
      city,
      items,
      brandName = BRAND_NAME,
      invoiceUrl,
    } = details;

    const lines: string[] = [];

    // 1. Greeting
    const safeCustomer = (customerName || "Customer").trim();
    lines.push(`Dear ${safeCustomer},`);

    // 2. Order Confirmation Header
    lines.push(`Your order #${orderNumber} has been confirmed!`);

    // 3. Items Summary
    if (items && items.length > 0) {
      const validItems = items.filter((i) => i && (i.name || i.product_name));
      if (validItems.length > 0) {
        const firstItem = validItems[0];
        const firstName = (firstItem.name || firstItem.product_name || "Item").trim();
        const firstQty = firstItem.quantity && firstItem.quantity > 1 ? ` (x${firstItem.quantity})` : ` (x1)`;

        let itemsStr = "";
        if (validItems.length === 1) {
          itemsStr = `${firstName.slice(0, 28)}${firstQty}`;
        } else if (validItems.length === 2) {
          const secondItem = validItems[1];
          const secondName = (secondItem.name || secondItem.product_name || "Item").trim();
          const secondQty = secondItem.quantity && secondItem.quantity > 1 ? ` (x${secondItem.quantity})` : ` (x1)`;
          itemsStr = `${firstName.slice(0, 18)}${firstQty}, ${secondName.slice(0, 18)}${secondQty}`;
        } else {
          itemsStr = `${firstName.slice(0, 22)}${firstQty} & ${validItems.length - 1} more`;
        }
        lines.push(`Items: ${itemsStr}`);
      }
    }

    // 4. Amount and Payment Method
    const methodUpper = (paymentMethod || "").toUpperCase();
    const paymentLabel =
      methodUpper === "COD" || methodUpper === "CASH_ON_DELIVERY"
        ? "Cash on Delivery"
        : methodUpper === "BKASH"
        ? "bKash"
        : methodUpper === "NAGAD"
        ? "Nagad"
        : methodUpper === "ROCKET"
        ? "Rocket"
        : methodUpper === "SSLCOMMERZ"
        ? "Paid Online"
        : paymentMethod
        ? paymentMethod
        : "Cash on Delivery";

    if (totalAmount !== undefined && totalAmount !== null) {
      const numAmount = typeof totalAmount === "number" ? Math.round(totalAmount) : Number(totalAmount) || 0;
      const formattedAmount = `BDT ${numAmount.toLocaleString("en-US")}`;
      lines.push(`Total: ${formattedAmount} (${paymentLabel})`);
    }

    // 5. Delivery Address & City
    const addressParts = [deliveryAddress, city].filter(Boolean).map((s) => s!.trim()).filter(Boolean);
    if (addressParts.length > 0) {
      const fullAddr = addressParts.join(", ");
      const cleanAddr = fullAddr.length > 45 ? `${fullAddr.slice(0, 42)}...` : fullAddr;
      lines.push(`Delivery: ${cleanAddr}`);
    }

    // 6. Invoice Link
    if (invoiceUrl) {
      lines.push(`Invoice: ${invoiceUrl}`);
    }

    // 7. Sign-off with Brand
    lines.push(`Thank you for shopping with ${brandName}.`);

    return lines.join("\n");
  }

  /**
   * Directly dispatch an order confirmation SMS with custom payload (e.g. from store checkout modal)
   */
  static async sendCustomOrderConfirmationSMS(payload: {
    orderNumber: string;
    customerName: string;
    phone: string;
    totalAmount?: number | string | null;
    paymentMethod?: string | null;
    deliveryAddress?: string | null;
    city?: string | null;
    items?: Array<{ name?: string; product_name?: string; quantity?: number }> | null;
    orderId?: string | null;
  }): Promise<SmsSendResult> {
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://anchorfashion.com").replace(/\/+$/, "");
    const targetId = payload.orderId || payload.orderNumber;
    // Phase 12: prefer the public token invoice link when the order has one.
    let invoiceUrl = targetId ? `${appUrl}/account/orders/${targetId}/invoice` : undefined;
    if (payload.orderId) {
      try {
        const { prisma } = await import("@/lib/prisma");
        const row = await prisma.order.findUnique({
          where: { id: payload.orderId },
          select: { invoiceToken: true },
        });
        if (row?.invoiceToken) {
          invoiceUrl = `${appUrl}/invoice/${row.invoiceToken}`;
        }
      } catch {
        // Keep the account-link fallback.
      }
    }

    const message = this.formatOrderConfirmationMessage({
      customerName: payload.customerName,
      orderNumber: payload.orderNumber,
      totalAmount: payload.totalAmount,
      paymentMethod: payload.paymentMethod,
      deliveryAddress: payload.deliveryAddress,
      city: payload.city,
      items: payload.items,
      invoiceUrl,
    });

    return await this.sendSMS({
      to: payload.phone,
      message,
      orderId: payload.orderId || undefined,
      type: "ORDER_CONFIRMATION",
    });
  }

  /**
   * Asynchronous fire-and-forget for custom order confirmation SMS.
   */
  static triggerCustomOrderConfirmationSmsAsync(payload: {
    orderNumber: string;
    customerName: string;
    phone: string;
    totalAmount?: number | string | null;
    paymentMethod?: string | null;
    deliveryAddress?: string | null;
    city?: string | null;
    items?: Array<{ name?: string; product_name?: string; quantity?: number }> | null;
    orderId?: string | null;
  }) {
    if (!payload?.phone) return;

    Promise.resolve().then(async () => {
      try {
        await this.sendCustomOrderConfirmationSMS(payload);
      } catch (err) {
      }
    });
  }

  /**
   * Asynchronous fire-and-forget helper.
   * Dispatches order confirmation SMS without delaying order response or blocking checkout execution.
   */
  static triggerOrderConfirmationSmsAsync(orderId: string, options?: { force?: boolean }) {
    if (!orderId) return;

    // Use Promise microtask detachment to allow immediate caller completion
    Promise.resolve().then(async () => {
      try {
        await this.sendOrderConfirmationSMS(orderId, options);
      } catch (err) {
      }
    });
  }

  /**
   * Record SMS in database.
   * FIX ROUND 28 (M-10): the audit trail lives in `communication_logs`
   * (real table; the order linkage rides in metadata). The previous
   * dual-strategy tried `sms_logs` first with columns that do not
   * exist on it (order_id, phone, type, provider, request_id,
   * error_message, updated_at — sms_logs has only id, recipient,
   * message, status, response, created_at), so that insert was
   * discarded whole on every call and only the fallback ever wrote.
   * The phantom first leg is removed; this is now the single store.
   */
  static async recordSmsLog(entry: {
    order_id?: string | null;
    phone: string;
    message: string;
    type: string;
    status: "PENDING" | "SENT" | "FAILED";
    provider: string;
    request_id?: string | null;
    response?: any;
    error_message?: string | null;
  }): Promise<{ id: string } | null> {
    const db = await createAdminDbClient();

    try {
      const { data, error } = await db
        .from("communication_logs")
        .insert({
          type: "SMS",
          direction: "OUTBOUND",
          subject: `Order SMS [${entry.type}]`,
          content: entry.message,
          status: entry.status,
          metadata: {
            order_id: entry.order_id,
            phone: entry.phone,
            provider: entry.provider,
            request_id: entry.request_id,
            response: entry.response,
            error_message: entry.error_message,
            sms_type: entry.type,
          },
        })
        .select("id")
        .maybeSingle();

      if (!error && data) {
        return data;
      }
      if (error) {
        console.error(
          `[sms-log] FAILED to record SMS log for order ${entry.order_id ?? "n/a"}: ${error.message}`
        );
      }
    } catch (commErr) {
      console.error(
        `[sms-log] EXCEPTION recording SMS log for order ${entry.order_id ?? "n/a"}: ${(commErr as Error)?.message || String(commErr)}`
      );
    }

    return null;
  }

  /**
   * Update orders table marking confirmation_sms_sent = true
   */
  private static async markOrderSmsSent(orderId: string) {
    const db = await createAdminDbClient();
    try {
      const { error } = await db
        .from("orders")
        .update({
          confirmation_sms_sent: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", orderId);

      if (error) {
        // If column does not exist yet, log silently
      }
    } catch (err) {
    }
  }

  /**
   * Check if a prior SENT log exists for this order
   */
  private static async checkPriorSentLog(orderId: string): Promise<any | null> {
    const db = await createAdminDbClient();

    // FIX ROUND 28 (M-10): logs live in communication_logs (see
    // recordSmsLog) — the old sms_logs leg filtered by phantom
    // order_id/type columns and could only ever return nothing.
    try {
      const { data } = await db
        .from("communication_logs")
        .select("*")
        .filter("metadata->>order_id", "eq", orderId)
        .eq("type", "SMS")
        .eq("status", "SENT")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        return {
          id: data.id,
          order_id: orderId,
          phone: data.metadata?.phone || "",
          message: data.content || "",
          request_id: data.metadata?.request_id || "",
          status: "SENT",
        };
      }
    } catch {
      // Ignored
    }

    return null;
  }

  /**
   * Get all SMS logs for a given order (used by Admin Dashboard and API)
   */
  static async getOrderSmsLogs(orderId: string): Promise<SmsLog[]> {
    const db = await createAdminDbClient();
    const logs: SmsLog[] = [];

    // FIX ROUND 28 (M-10): single store — communication_logs (see
    // recordSmsLog). The old sms_logs leg filtered by the phantom
    // order_id column and could only ever return empty.
    try {
      const { data, error } = await db
        .from("communication_logs")
        .select("*")
        .filter("metadata->>order_id", "eq", orderId)
        .eq("type", "SMS")
        .order("created_at", { ascending: false });

      if (!error && data && data.length > 0) {
        for (const item of data) {
          logs.push({
            id: item.id,
            order_id: orderId,
            phone: item.metadata?.phone || "N/A",
            message: item.content || "",
            type: item.metadata?.sms_type || "ORDER_CONFIRMATION",
            status: item.status as any,
            provider: item.metadata?.provider || "ALPHA_SMS",
            request_id: item.metadata?.request_id || null,
            response: item.metadata?.response || null,
            error_message: item.metadata?.error_message || null,
            created_at: item.created_at,
            updated_at: item.created_at,
          });
        }
      }
    } catch {
      // Ignored
    }

    return logs;
  }
}
