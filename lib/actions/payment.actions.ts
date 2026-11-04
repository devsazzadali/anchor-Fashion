"use server";

import { createDbClient } from "@/lib/db/client";
import { createAdminDbClient } from "@/lib/db/client";
import { verifyAdmin, verifyManager, verifyStaff } from "../security/roles";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { ensureOrderPaymentSuccess } from "@/lib/payments/order-payment-record";
import { paymentRowToLegacyTransaction } from "@/lib/payments/order-payment-record";

const SECRET_CONFIG_KEYS = ["store_id", "store_password", "store_pass", "store_passwd"] as const;

/** Removes gateway credentials so a config can safely be sent to the browser. */
function stripPaymentSecrets(cfg: PaymentGatewayConfig): PaymentGatewayConfig {
  const clean: Record<string, any> = { ...cfg };
  for (const k of SECRET_CONFIG_KEYS) delete clean[k];
  return clean as PaymentGatewayConfig;
}

export type PaymentGatewayType =
  | "sslcommerz"
  | "cod"
  | "bkash"
  | "nagad"
  | "rocket"
  | "bank";

export type PaymentGatewayConfig = {
  enabled: boolean;
  store_id?: string;
  store_password?: string;
  store_pass?: string;
  store_passwd?: string;
  sandbox?: boolean;
  is_sandbox?: boolean;
  account_number?: string;
  account_type?: "Personal" | "Merchant" | "Agent" | string;
  instructions?: string;
  bank_name?: string;
  account_name?: string;
  branch_name?: string;
  routing_number?: string;
};

export type AllPaymentConfigs = Record<PaymentGatewayType, PaymentGatewayConfig>;

// REG-65 batch 2: row shapes for the untyped db shim, derived from the
// select lists in this file (the shim returns snake_case rows).
// Stored gateway configs may carry sandbox flags as strings ("true");
// the loader below deliberately accepts both forms.
type PaymentConfigSettingsValue = Omit<
  Partial<PaymentGatewayConfig>,
  "sandbox" | "is_sandbox"
> & {
  sandbox?: boolean | string;
  is_sandbox?: boolean | string;
};

interface PaymentConfigSettingsRow {
  key: string;
  value: PaymentConfigSettingsValue | null;
}

interface ManualPaymentOrderRow {
  id: string;
  customer_id: string | null;
  grand_total: number | null;
  // Not in the select list; read defensively as a fallback total.
  total_amount?: number | null;
  payment_status: string | null;
}

interface PaymentLedgerRow {
  id: string;
  order_id: string;
  amount: number;
  method: string | null;
  status: string | null;
  transaction_id: string | null;
  gateway_response: Record<string, any> | null;
  created_at: string | null;
  updated_at: string | null;
}

interface OrderShippingAddressJson {
  phone?: string | null;
  phone_number?: string | null;
}

interface PaymentProviderRow {
  id: string;
  code: string;
  name: string;
}

interface ManualQueueOrderRow {
  id: string;
  order_number: string | null;
  grand_total: number | null;
  status: string | null;
  payment_status: string | null;
  payment_method: string | null;
  created_at: string | null;
  customer_id: string | null;
}

// The shape paymentRowToLegacyTransaction (lib/payments/order-payment-record)
// maps a payments row to; derived from that mapper's return literal.
interface LegacyPaymentTransaction {
  id: string;
  // payments.order_id is a non-null column; the mapper passes it through.
  order_id: string;
  method: string | null;
  session_id: string | null;
  provider_id: string | null;
  user_id: string | null;
  amount: number;
  currency: string;
  status: string;
  reference_number: string | null;
  gateway_transaction_id: string | null;
  gateway_response: Record<string, any>;
  error_code: string | null;
  error_message: string | null;
  created_at: string | null;
  updated_at: string | null;
}

// Queue items are enriched legacy transactions, plus synthesized entries
// for manual orders without a ledger row (which lack the legacy-only
// fields below, hence optional).
interface ManualPaymentQueueItem {
  id: string;
  order_id: string | null;
  user_id?: string | null;
  provider_id: string | null;
  provider_name: string;
  method?: string | null;
  session_id?: string | null;
  amount: number;
  currency: string;
  status: string;
  reference_number: string | null;
  gateway_transaction_id: string | null;
  gateway_response: Record<string, any>;
  error_code?: string | null;
  error_message?: string | null;
  created_at: string | null;
  updated_at: string | null;
  order: ManualQueueOrderRow | null;
  item_count: number;
}

const DEFAULTS: AllPaymentConfigs = {
  sslcommerz: {
    enabled: true,
    store_id: "",
    store_password: "",
    sandbox: true,
  },
  cod: {
    enabled: true,
    instructions: "Pay with cash upon receiving your delivery at your doorstep.",
  },
  // REG-80: manual gateways ship UNCONFIGURED — disabled, with empty
  // account fields. They previously carried placeholder account numbers
  // (sequential test numbers and an invented bank account) as the
  // defaults, so an unset admin config showed customers fake numbers to
  // send real money to. An admin must enter the real account details and
  // enable the method in Admin → Payments before it appears at checkout.
  bkash: {
    enabled: false,
    account_number: "",
    account_type: "Personal",
    instructions:
      "Go to your bKash app or dial *247# -> Choose Send Money -> Enter our bKash number -> Enter your Order Total -> Enter Reference -> Complete payment and copy the Transaction ID (TrxID).",
  },
  nagad: {
    enabled: false,
    account_number: "",
    account_type: "Personal",
    instructions:
      "Go to your Nagad app or dial *167# -> Send Money to our number -> Enter your Order Total -> Confirm with PIN and copy the Transaction ID (TrxID).",
  },
  rocket: {
    enabled: false,
    account_number: "",
    account_type: "Personal",
    instructions:
      "Go to your Rocket app or dial *322# -> Send Money -> Enter our Rocket account -> Complete payment and copy the Transaction ID.",
  },
  bank: {
    enabled: false,
    bank_name: "",
    account_name: "",
    account_number: "",
    branch_name: "",
    routing_number: "",
    instructions:
      "Transfer the exact order amount via Online/Internet Banking, BEFTN, NPSB, or Direct Cash Deposit. Enter your Order Number in the deposit/transfer reference.",
  },
};

export async function getPaymentConfig(
  gateway: PaymentGatewayType
): Promise<PaymentGatewayConfig> {
  // Public reader: never returns gateway credentials.
  if (!Object.prototype.hasOwnProperty.call(DEFAULTS, gateway)) {
    throw new Error("Unknown payment gateway");
  }
  const db = await createDbClient();
  try {
    const { data } = await db
      .from("settings")
      .select("value")
      .eq("key", `payment_${gateway}`)
      .single();

    return stripPaymentSecrets(
      (data?.value as PaymentGatewayConfig) ?? DEFAULTS[gateway]
    );
  } catch {
    return stripPaymentSecrets(DEFAULTS[gateway]);
  }
}

/**
 * Storefront-safe payment configuration (no gateway credentials).
 * Use this for anything rendered to customers.
 */
export async function getPublicPaymentConfigs(): Promise<AllPaymentConfigs> {
  const all = await loadAllPaymentConfigs();
  const safe = {} as AllPaymentConfigs;
  for (const key of Object.keys(all) as PaymentGatewayType[]) {
    safe[key] = stripPaymentSecrets(all[key]);
  }
  return safe;
}

/** Full configuration INCLUDING credentials. Administrators only. */
export async function getAllPaymentConfigs(): Promise<AllPaymentConfigs> {
  await verifyAdmin();
  return loadAllPaymentConfigs();
}

async function loadAllPaymentConfigs(): Promise<AllPaymentConfigs> {
  const db = await createDbClient();
  const result: AllPaymentConfigs = { ...DEFAULTS };

  try {
    const { data } = await db
      .from("settings")
      .select("key, value")
      .like("key", "payment_%");

    if (data && data.length > 0) {
      data.forEach((row: PaymentConfigSettingsRow) => {
        const gw = row.key.replace("payment_", "") as PaymentGatewayType;
        if (result[gw]) {
          const val: PaymentConfigSettingsValue = row.value || {};
          if (gw === "sslcommerz") {
            const pass = (
              val.store_password ||
              val.store_pass ||
              val.store_passwd ||
              ""
            ).toString().trim();
            const isSandbox =
              val.sandbox !== undefined
                ? val.sandbox === true || val.sandbox === "true"
                : val.is_sandbox !== undefined
                ? val.is_sandbox === true || val.is_sandbox === "true"
                : true;
            result[gw] = {
              ...result[gw],
              ...val,
              store_id: (val.store_id || "").toString().trim(),
              store_password: pass,
              store_pass: pass,
              store_passwd: pass,
              sandbox: isSandbox,
              is_sandbox: isSandbox,
            };
          } else {
            // The stored JSON is merged verbatim (a string sandbox flag
            // would ride along, as it does today); the declared config
            // type keeps sandbox boolean.
            result[gw] = { ...result[gw], ...val } as PaymentGatewayConfig;
          }
        }
      });
    }
  } catch (err) {
  }

  return result;
}

export async function updatePaymentConfig(
  gateway: PaymentGatewayType,
  config: PaymentGatewayConfig
) {
  try {
    await verifyAdmin(); // Enforced: unauthorized callers must NOT reach the write below
    const db = createAdminDbClient();

    let normalizedConfig: Record<string, any> = { ...config };
    if (gateway === "sslcommerz") {
      const pass = (
        config.store_password ||
        config.store_pass ||
        config.store_passwd ||
        ""
      ).toString().trim();
      const isSandbox =
        config.sandbox !== undefined
          ? Boolean(config.sandbox)
          : config.is_sandbox !== undefined
          ? Boolean(config.is_sandbox)
          : true;

      normalizedConfig = {
        ...config,
        store_id: (config.store_id || "").toString().trim(),
        store_password: pass,
        store_pass: pass,
        store_passwd: pass,
        sandbox: isSandbox,
        is_sandbox: isSandbox,
      };
    }

    const { error } = await db.from("settings").upsert(
      {
        key: `payment_${gateway}`,
        value: normalizedConfig,
        description: `${gateway.toUpperCase()} Configuration`,
      },
      { onConflict: "key" }
    );

    if (error) throw error;

    revalidatePath("/admin/settings/payment");
    revalidatePath("/admin/payments/providers");
    revalidatePath("/checkout");
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export interface ManualPaymentSubmission {
  order_id: string;
  payment_method: string; // 'BKASH' | 'NAGAD' | 'ROCKET' | 'BANK_TRANSFER'
  amount: number;
  sender_number?: string;
  transaction_id?: string;
  bank_name?: string;
  branch_name?: string;
  account_holder_name?: string;
  notes?: string;
  customer_id?: string | null;
}

/**
 * Record customer manual payment submission.
 * FIX ROUND 28 (M-2): this used to write to a `payment_transactions`
 * table that does not exist in this schema — every submission was
 * silently discarded while the customer was told it succeeded. The
 * record now lands on the real `payments` ledger: the submission
 * details ride inside gateway_response (see the convention in
 * lib/payments/order-payment-record), attached to the order's PENDING
 * placement row when one exists so each order keeps ONE ledger row.
 */
export async function recordManualPaymentTransaction(
  submission: ManualPaymentSubmission
) {
  const db = createAdminDbClient();
  try {
    // SECURITY: never trust client-supplied amount / customer. Resolve from the order.
    const orderId = String(submission.order_id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
      return { success: false, error: "Invalid order" };
    }
    const { data: orderData } = await db
      .from("orders")
      .select("id, customer_id, grand_total, payment_status")
      .eq("id", orderId)
      .maybeSingle();
    const order: ManualPaymentOrderRow | null = orderData ?? null;
    if (!order) {
      return { success: false, error: "Order not found" };
    }
    if (String(order.payment_status || "").toLowerCase() === "paid") {
      return { success: false, error: "Order is already paid" };
    }
    const clip = (v: unknown, n: number) =>
      typeof v === "string" ? v.slice(0, n) : v == null ? undefined : String(v).slice(0, n);
    submission = {
      order_id: order.id,
      payment_method: String(clip(submission.payment_method, 30) || ""),
      amount:
        Number(
          order.grand_total ??
            order.total_amount ??
            submission.amount
        ) || 0,
      sender_number: clip(submission.sender_number, 40),
      transaction_id: clip(submission.transaction_id, 80),
      bank_name: clip(submission.bank_name, 120),
      branch_name: clip(submission.branch_name, 120),
      account_holder_name: clip(submission.account_holder_name, 120),
      notes: clip(submission.notes, 500),
      customer_id: order.customer_id || null,
    };

    const rawMethod = (submission.payment_method || "").toLowerCase();
    const { data: prov } = await db
      .from("payment_providers")
      .select("id")
      .eq("code", rawMethod)
      .maybeSingle();

    const providerId = prov?.id || null;
    const referenceNumber =
      submission.sender_number ||
      submission.account_holder_name ||
      submission.bank_name ||
      "";
    const transactionId = submission.transaction_id || "";

    const gwMeta = {
      payment_method: submission.payment_method,
      sender_number: submission.sender_number,
      transaction_id: submission.transaction_id,
      bank_name: submission.bank_name,
      branch_name: submission.branch_name,
      account_holder_name: submission.account_holder_name,
      notes: submission.notes,
      reference_number: referenceNumber,
      provider_id: providerId,
      user_id: submission.customer_id || null,
      currency: "BDT",
      submitted_at: new Date().toISOString(),
    };

    let txRow: PaymentLedgerRow | null = null;
    const { data: pendingRowsData } = await db
      .from("payments")
      .select("*")
      .eq("order_id", submission.order_id)
      .eq("status", "PENDING")
      .order("created_at", { ascending: true })
      .limit(1);
    const pendingRows: PaymentLedgerRow[] = pendingRowsData || [];

    if (pendingRows && pendingRows.length > 0) {
      const existing = pendingRows[0];
      const { data: updated } = await db
        .from("payments")
        .update({
          method: (submission.payment_method || existing.method || "BKASH").toUpperCase(),
          transaction_id: transactionId || existing.transaction_id || null,
          gateway_response: {
            ...(existing.gateway_response || {}),
            ...gwMeta,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .select()
        .single();
      txRow = updated || existing;
    } else {
      const { data: inserted } = await db
        .from("payments")
        .insert({
          order_id: submission.order_id,
          amount: submission.amount,
          method: (submission.payment_method || "BKASH").toUpperCase(),
          status: "PENDING",
          transaction_id: transactionId || null,
          gateway_response: gwMeta,
        })
        .select()
        .single();
      txRow = inserted;
    }

    const tx = txRow ? paymentRowToLegacyTransaction(txRow) : null;
    if (!tx) {
      console.error(
        `[manual-payment] FAILED to record submission for order ${submission.order_id} on the payments ledger`
      );
    }

    // Add note to order_notes
    const noteContent = `Manual Payment Submitted: [${submission.payment_method}] Sender: ${referenceNumber || "N/A"}, TrxID/Ref: ${transactionId || "N/A"}${submission.notes ? ` - Note: ${submission.notes}` : ""}`;
    try {
      await db.from("order_notes").insert({
        order_id: submission.order_id,
        author_id: submission.customer_id || null,
        note: noteContent,
        is_customer_visible: true,
      });
    } catch {
      // Ignored
    }

    if (!tx) {
      return {
        success: false,
        error:
          "Payment submission could not be recorded. Please try again or contact support.",
      };
    }

    return { success: true, transaction: tx };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Get manual payment details for a specific order.
 * FIX ROUND 28 (M-2): reads the real `payments` ledger (the phantom
 * payment_transactions table meant this always returned null) and maps
 * the row to the legacy transaction shape callers consume.
 */
export async function getManualPaymentForOrder(orderId: string) {
  await verifyStaff();
  const db = await createDbClient();
  try {
    const { data, error } = await db
      .from("payments")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return paymentRowToLegacyTransaction(data);
  } catch {
    return null;
  }
}

/**
 * Admin action: Approve manual payment
 * Transitions payment_status to 'paid', order status to 'confirmed', and logs status history
 */
export async function approveManualPaymentAction(
  orderId: string,
  transactionId?: string,
  approvalNote?: string
) {
  await verifyManager();
  const db = createAdminDbClient();
  try {
    // 0. Verify order has items before approving payment
    const { data: items, error: itemsErr } = await db
      .from("order_items")
      .select("id")
      .eq("order_id", orderId);

    if (itemsErr) {
    } else if (!items || items.length === 0) {
      return {
        success: false,
        error: "Cannot approve payment: Order has 0 items. Please ensure order items are recorded before approving payment.",
      };
    }

    // 1. Update or create the ledger row on the REAL `payments` table.
    // FIX ROUND 28 (M-2): this block previously wrote to the phantom
    // payment_transactions table — approvals updated nothing there.
    // Submission meta lives in gateway_response; merges are
    // read-then-write so the customer's submission details survive.
    const markPaymentsRowApproved = async (row: PaymentLedgerRow) => {
      await db
        .from("payments")
        .update({
          status: "SUCCESS",
          gateway_response: {
            ...(row?.gateway_response || {}),
            error_message: null,
            approved_manually_at: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    };

    if (transactionId && !transactionId.startsWith("order-manual-")) {
      const { data: row } = await db
        .from("payments")
        .select("*")
        .eq("id", transactionId)
        .maybeSingle();
      if (row) await markPaymentsRowApproved(row);
    } else {
      const { data: existingTx } = await db
        .from("payments")
        .select("*")
        .eq("order_id", orderId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingTx) {
        await markPaymentsRowApproved(existingTx);
      } else {
        const { data: orderData } = await db
          .from("orders")
          .select("payment_method, grand_total, customer_id, order_number, shipping_address")
          .eq("id", orderId)
          .maybeSingle();

        const rawMethod = (orderData?.payment_method || "").toLowerCase();
        const { data: prov } = await db
          .from("payment_providers")
          .select("id")
          .eq("code", rawMethod)
          .maybeSingle();

        // FIX ROUND 28 (M-2): order_addresses does not exist — the
        // phone lives in the order's shipping_address JSON.
        const shippingJson: OrderShippingAddressJson =
          orderData?.shipping_address || {};
        const customerPhone =
          shippingJson.phone ||
          shippingJson.phone_number ||
          orderData?.order_number ||
          "";

        await db.from("payments").insert({
          order_id: orderId,
          amount: orderData?.grand_total || 0,
          method: (orderData?.payment_method || "BKASH").toUpperCase(),
          status: "SUCCESS",
          transaction_id: "MANUAL-ADMIN-APPROVAL",
          gateway_response: {
            payment_method: orderData?.payment_method,
            sender_number: customerPhone,
            transaction_id: "MANUAL-ADMIN-APPROVAL",
            reference_number: customerPhone,
            provider_id: prov?.id || null,
            user_id: orderData?.customer_id || null,
            currency: "BDT",
            approved_manually_at: new Date().toISOString(),
          },
        });
      }
    }

    // 2. Update orders table
    const { error: orderErr } = await db
      .from("orders")
      .update({
        payment_status: "paid",
        status: "confirmed",
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId);

    if (orderErr) throw orderErr;

    // 2b. REG-18 (kept as a backstop after the Round-28 M-2 rewire):
    // this approval marks the order PAID outside the OMS status
    // transition — ensure the REAL payments ledger carries the
    // collection even if the step-1 row update/insert above missed
    // (e.g. no row existed and its insert failed), the same guarantee
    // the COD delivery path makes. Never fail the approval on a
    // ledger error.
    try {
      const ord = await prisma.order.findUnique({
        where: { id: orderId },
        select: { totalAmount: true, paymentMethod: true },
      });
      if (ord) {
        await ensureOrderPaymentSuccess({
          orderId,
          amount: Number(ord.totalAmount ?? 0),
          method: ord.paymentMethod,
        });
      }
    } catch (payErr) {
    }

    // 3. Log to order_status_history
    await db.from("order_status_history").insert({
      order_id: orderId,
      status: "confirmed",
      notes:
        approvalNote ||
        "Manual payment verified and approved by Administrator. Status advanced to Confirmed.",
    });

    // 4. Log to order_notes
    await db.from("order_notes").insert({
      order_id: orderId,
      note: `Payment Approved by Admin: Order marked as Paid & Confirmed. ${approvalNote ? `(${approvalNote})` : ""}`,
      is_customer_visible: true,
    });

    // 5. Trigger Order Confirmation SMS asynchronously
    try {
      const { AlphaSmsService } = await import("@/lib/services/sms/alpha-sms.service");
      AlphaSmsService.triggerOrderConfirmationSmsAsync(orderId);
    } catch (smsErr) {
    }

    try {
      revalidatePath(`/admin/orders/${orderId}`);
      revalidatePath("/admin/orders");
      revalidatePath("/admin/finance/manual-payments");
    } catch {
      // Ignore if called outside Next.js request context (e.g. tests, scripts)
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Admin action: Reject manual payment
 */
export async function rejectManualPaymentAction(
  orderId: string,
  reason: string,
  transactionId?: string
) {
  await verifyManager();
  const db = createAdminDbClient();
  try {
    // 1. Update or create the ledger row on the REAL `payments` table.
    // FIX ROUND 28 (M-2): previously the phantom payment_transactions
    // table — rejections updated nothing there. The reason rides in
    // gateway_response.error_message, merged over the submission meta.
    const markPaymentsRowRejected = async (row: PaymentLedgerRow) => {
      await db
        .from("payments")
        .update({
          status: "FAILED",
          gateway_response: {
            ...(row?.gateway_response || {}),
            error_message: reason,
            rejected_manually_at: new Date().toISOString(),
            reason,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    };

    if (transactionId && !transactionId.startsWith("order-manual-")) {
      const { data: row } = await db
        .from("payments")
        .select("*")
        .eq("id", transactionId)
        .maybeSingle();
      if (row) await markPaymentsRowRejected(row);
    } else {
      const { data: existingTx } = await db
        .from("payments")
        .select("*")
        .eq("order_id", orderId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingTx) {
        await markPaymentsRowRejected(existingTx);
      } else {
        const { data: orderData } = await db
          .from("orders")
          .select("payment_method, grand_total, customer_id, order_number")
          .eq("id", orderId)
          .maybeSingle();

        const rawMethod = (orderData?.payment_method || "").toLowerCase();
        const { data: prov } = await db
          .from("payment_providers")
          .select("id")
          .eq("code", rawMethod)
          .maybeSingle();

        await db.from("payments").insert({
          order_id: orderId,
          amount: orderData?.grand_total || 0,
          method: (orderData?.payment_method || "BKASH").toUpperCase(),
          status: "FAILED",
          gateway_response: {
            payment_method: orderData?.payment_method,
            error_message: reason,
            reference_number: orderData?.order_number || "",
            provider_id: prov?.id || null,
            user_id: orderData?.customer_id || null,
            currency: "BDT",
            rejected_manually_at: new Date().toISOString(),
            reason,
          },
        });
      }
    }

    // 2. Update orders table
    await db
      .from("orders")
      .update({
        payment_status: "unpaid",
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId);

    // 3. Log to order_notes
    await db.from("order_notes").insert({
      order_id: orderId,
      note: `Payment Rejected by Admin. Reason: ${reason}`,
      is_customer_visible: true,
    });

    // 4. Log to order_status_history
    await db.from("order_status_history").insert({
      order_id: orderId,
      status: "pending_payment",
      notes: `Manual payment verification failed: ${reason}`,
    });

    try {
      revalidatePath(`/admin/orders/${orderId}`);
      revalidatePath("/admin/orders");
      revalidatePath("/admin/finance/manual-payments");
    } catch {
      // Ignore if called outside Next.js request context (e.g. tests, scripts)
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Fetch all pending manual payments for Admin Finance verification queue
 */
export async function getPendingManualPaymentsAction() {
  await verifyManager();
  const db = createAdminDbClient();
  try {
    // 1. Fetch manual payment providers (bKash, Nagad, Rocket)
    const { data: providers } = await db
      .from("payment_providers")
      .select("id, code, name")
      .in("code", ["bkash", "nagad", "rocket"]);

    const providerMap = new Map<string, { id: string; code: string; name: string }>();
    const providerIds = (providers || []).map((p: PaymentProviderRow) => {
      providerMap.set(p.id, p);
      return p.id;
    });

    // 2. Fetch the manual-method rows from the REAL `payments` ledger.
    // FIX ROUND 28 (M-2): this queue previously read the phantom
    // payment_transactions table, so it only ever showed the
    // synthesized entries below. On `payments`, the manual linkage is
    // the method itself and the gateway_response meta (provider_id,
    // payment_method); filter in JS and map rows to the legacy
    // transaction shape the enrichment below consumes.
    const MANUAL_METHOD_CODES = new Set([
      "bkash",
      "nagad",
      "rocket",
      "bank",
      "bank_transfer",
    ]);
    const { data: paymentRows, error } = await db
      .from("payments")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      return [];
    }

    const txs = (paymentRows || [])
      .map((r: PaymentLedgerRow) => paymentRowToLegacyTransaction(r))
      .filter((t: LegacyPaymentTransaction) => {
        const gw = t.gateway_response || {};
        const methodCode = String(
          t.method || gw.payment_method || ""
        ).toLowerCase();
        return (
          (t.provider_id && providerIds.includes(t.provider_id)) ||
          MANUAL_METHOD_CODES.has(methodCode)
        );
      });

    // 3. Collect related order IDs from transactions
    const orderIds: string[] = Array.from(
      new Set((txs || []).map((t: LegacyPaymentTransaction) => t.order_id).filter(Boolean))
    );

    // Also look up orders placed with manual payment methods
    const { data: manualOrders } = await db
      .from("orders")
      .select("id, order_number, grand_total, status, payment_status, payment_method, created_at, customer_id")
      .in("payment_method", [
        "BKASH",
        "NAGAD",
        "ROCKET",
        "BANK",
        "BANK_TRANSFER",
        "bkash",
        "nagad",
        "rocket",
        "bank",
        "bank_transfer",
      ]);

    const orderMap = new Map<string, ManualQueueOrderRow>();
    (manualOrders || []).forEach((o: ManualQueueOrderRow) => orderMap.set(o.id, o));

    // Fetch any missing orders referenced by existing transactions
    const missingOrderIds = orderIds.filter((id: string) => !orderMap.has(id));
    if (missingOrderIds.length > 0) {
      const { data: moreOrders } = await db
        .from("orders")
        .select("id, order_number, grand_total, status, payment_status, payment_method, created_at, customer_id")
        .in("id", missingOrderIds);

      (moreOrders || []).forEach((o: ManualQueueOrderRow) => orderMap.set(o.id, o));
    }

    const existingTxOrderIds = new Set((txs || []).map((t: LegacyPaymentTransaction) => t.order_id));

    // Query order_items count for all relevant orders
    const allOrderIds: string[] = Array.from(
      new Set([...orderIds, ...(manualOrders || []).map((o: ManualQueueOrderRow) => o.id)])
    );
    const { data: itemRows } = await db
      .from("order_items")
      .select("order_id")
      .in("order_id", allOrderIds);

    const itemsCountMap = new Map<string, number>();
    (itemRows || []).forEach((row: { order_id: string }) => {
      itemsCountMap.set(row.order_id, (itemsCountMap.get(row.order_id) || 0) + 1);
    });

    // 4. Enrich transactions with order details and canonical provider_id
    const enrichedList: ManualPaymentQueueItem[] = (txs || [])
      .filter((t: LegacyPaymentTransaction) => t.order_id && orderMap.has(t.order_id))
      .map((t: LegacyPaymentTransaction) => {
        const order = orderMap.get(t.order_id) || null;
        const matchedProvider = t.provider_id ? providerMap.get(t.provider_id) : null;
        const method = (
          matchedProvider?.code ||
          t.gateway_response?.payment_method ||
          order?.payment_method ||
          "bank"
        ).toLowerCase();

        return {
          ...t,
          provider_id: method,
          provider_name: matchedProvider?.name || method.toUpperCase(),
          order,
          item_count: itemsCountMap.get(t.order_id) || 0,
        };
      });

    // 5. Synthesize queue items for any manual orders that don't have a transaction record yet
    for (const o of manualOrders || []) {
      if (!existingTxOrderIds.has(o.id)) {
        // Skip cancelled orders or orders with 0 items from being queued for manual payment approval
        if (o.status === "cancelled") continue;
        const itemCount = itemsCountMap.get(o.id) || 0;
        if (itemCount === 0) continue;

        enrichedList.push({
          id: `order-manual-${o.id}`,
          order_id: o.id,
          user_id: o.customer_id,
          provider_id: (o.payment_method || "bkash").toLowerCase(),
          provider_name: (o.payment_method || "MANUAL").toUpperCase(),
          amount: o.grand_total || 0,
          currency: "BDT",
          status: o.payment_status?.toLowerCase() === "paid" ? "completed" : "pending",
          reference_number: o.order_number,
          gateway_transaction_id: "Pending Submission",
          gateway_response: {
            payment_method: o.payment_method,
            submitted_at: o.created_at,
          },
          created_at: o.created_at,
          updated_at: o.created_at,
          order: o,
          item_count: itemCount,
        });
      }
    }

    return enrichedList;
  } catch (err) {
    return [];
  }
}
