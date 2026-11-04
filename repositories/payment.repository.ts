import { createAdminDbClient } from "@/lib/db/client";
import {
  PaymentProvider,
  PaymentSession,
  PaymentTransaction,
  PaymentWebhook,
  PaymentRefund,
  PaymentAuditLog,
} from "@/types/payment";
import {
  paymentRowToLegacyTransaction,
  legacyStatusToPaymentStatus,
} from "@/lib/payments/order-payment-record";

/**
 * FIX ROUND 28 (M-2): this repository targeted a `payment_transactions`
 * table that does not exist in this schema — every transaction write
 * was discarded and every read resolved empty (the live cancel/refund
 * path in app/actions/oms/order.actions.ts runs through here). The
 * real ledger is `payments` (id, order_id, amount, method, status,
 * transaction_id, gateway_response, created_at, updated_at); the
 * legacy fields (session_id, provider_id, user_id, currency,
 * reference_number, error_code, error_message) ride inside
 * gateway_response per the convention in
 * lib/payments/order-payment-record, and rows are mapped back to the
 * legacy PaymentTransaction shape on read so callers (notably
 * PaymentService.processRefund's `status !== "completed"` guard) keep
 * working unchanged.
 */
/**
 * REG-65 batch 1: a row of the real `payment_refunds` ledger
 * (id, payment_id, order_id, amount, reason, status, created_at).
 */
interface PaymentRefundLedgerRow {
  id: string;
  payment_id: string | null;
  order_id: string | null;
  amount: number;
  reason: string | null;
  status: string;
  created_at: string;
}

function toPaymentsInsert(t: Partial<PaymentTransaction>, method: string) {
  const gw: Record<string, unknown> = { ...(t.gateway_response || {}) };
  if (t.session_id !== undefined) gw.session_id = t.session_id;
  if (t.provider_id !== undefined) gw.provider_id = t.provider_id;
  if (t.user_id !== undefined) gw.user_id = t.user_id;
  if (t.currency !== undefined) gw.currency = t.currency;
  if (t.reference_number !== undefined) gw.reference_number = t.reference_number;
  if (t.error_code !== undefined) gw.error_code = t.error_code;
  if (t.error_message !== undefined) gw.error_message = t.error_message;
  return {
    order_id: t.order_id,
    amount: t.amount,
    method,
    status: legacyStatusToPaymentStatus(t.status),
    transaction_id: t.gateway_transaction_id ?? null,
    gateway_response: gw,
  };
}

const LEGACY_META_KEYS = [
  "session_id",
  "provider_id",
  "user_id",
  "currency",
  "reference_number",
  "error_code",
  "error_message",
] as const;

export class PaymentRepository {
  /**
   * Providers.
   * FIX ROUND 28 (M-5 class): payment_providers' active flag is
   * `is_active` — there is no `status` or `is_fallback` column, so
   * both queries below were filter-poisoned and returned nothing.
   */
  async getActiveProviders(): Promise<PaymentProvider[]> {
    const db = await createAdminDbClient();
    const { data, error } = await db
      .from("payment_providers")
      .select("*")
      .eq("is_active", true);

    if (error)
      throw new Error(`Failed to get active providers: ${error.message}`);
    return data as PaymentProvider[];
  }

  async getProviderByCode(code: string): Promise<PaymentProvider | null> {
    const db = await createAdminDbClient();
    const { data, error } = await db
      .from("payment_providers")
      .select("*")
      .eq("code", code)
      .single();

    if (error && error.code !== "PGRST116")
      throw new Error(`Failed to get provider: ${error.message}`);
    return data as PaymentProvider | null;
  }

  async getFallbackProvider(): Promise<PaymentProvider | null> {
    const db = await createAdminDbClient();
    // No is_fallback flag exists in this schema — the fallback is the
    // lowest-sort_order active provider (Round 28, M-5 class).
    const { data, error } = await db
      .from("payment_providers")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error && error.code !== "PGRST116")
      throw new Error(`Failed to get fallback provider: ${error.message}`);
    return data as PaymentProvider | null;
  }

  /**
   * Sessions
   */
  async createSession(
    session: Partial<PaymentSession>
  ): Promise<PaymentSession> {
    const db = await createAdminDbClient();
    const { data, error } = await db
      .from("payment_sessions")
      .insert(session)
      .select()
      .single();

    if (error) throw new Error(`Failed to create session: ${error.message}`);
    return data as PaymentSession;
  }

  async getSessionById(id: string): Promise<PaymentSession | null> {
    const db = await createAdminDbClient();
    const { data, error } = await db
      .from("payment_sessions")
      .select("*")
      .eq("id", id)
      .single();

    if (error && error.code !== "PGRST116")
      throw new Error(`Failed to get session: ${error.message}`);
    return data as PaymentSession | null;
  }

  async updateSession(
    id: string,
    updates: Partial<PaymentSession>
  ): Promise<PaymentSession> {
    const db = await createAdminDbClient();
    const { data, error } = await db
      .from("payment_sessions")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update session: ${error.message}`);
    return data as PaymentSession;
  }

  /**
   * Transactions — backed by the real `payments` ledger (Round 28, M-2).
   */
  async createTransaction(
    transaction: Partial<PaymentTransaction>
  ): Promise<PaymentTransaction> {
    const db = await createAdminDbClient();
    // payments.method is a real column with no provider FK — resolve
    // the method code from the provider row when one is referenced.
    let method = "UNKNOWN";
    if (transaction.provider_id) {
      const { data: prov } = await db
        .from("payment_providers")
        .select("code")
        .eq("id", transaction.provider_id)
        .maybeSingle();
      if (prov?.code) method = String(prov.code).toUpperCase();
    }
    const { data, error } = await db
      .from("payments")
      .insert(toPaymentsInsert(transaction, method))
      .select()
      .single();

    if (error)
      throw new Error(`Failed to create transaction: ${error.message}`);
    return paymentRowToLegacyTransaction(data) as PaymentTransaction;
  }

  async getTransactionById(id: string): Promise<PaymentTransaction | null> {
    const db = await createAdminDbClient();
    const { data, error } = await db
      .from("payments")
      .select("*")
      .eq("id", id)
      .single();

    if (error && error.code !== "PGRST116")
      throw new Error(`Failed to get transaction: ${error.message}`);
    return data
      ? (paymentRowToLegacyTransaction(data) as PaymentTransaction)
      : null;
  }

  async getTransactionByReference(
    reference: string
  ): Promise<PaymentTransaction | null> {
    const db = await createAdminDbClient();
    // A reference is either the gateway transaction id (payments
    // .transaction_id) or the reference_number kept in gateway_response.
    const { data: byTxId } = await db
      .from("payments")
      .select("*")
      .eq("transaction_id", reference)
      .limit(1)
      .maybeSingle();
    if (byTxId)
      return paymentRowToLegacyTransaction(byTxId) as PaymentTransaction;

    const { data: byRef } = await db
      .from("payments")
      .select("*")
      .filter("gateway_response->>reference_number", "eq", reference)
      .limit(1)
      .maybeSingle();
    return byRef
      ? (paymentRowToLegacyTransaction(byRef) as PaymentTransaction)
      : null;
  }

  async getTransactionBySessionId(
    sessionId: string
  ): Promise<PaymentTransaction | null> {
    const db = await createAdminDbClient();
    // session_id lives in gateway_response on the payments ledger.
    const { data } = await db
      .from("payments")
      .select("*")
      .filter("gateway_response->>session_id", "eq", sessionId)
      .limit(1)
      .maybeSingle();
    return data
      ? (paymentRowToLegacyTransaction(data) as PaymentTransaction)
      : null;
  }

  async updateTransaction(
    id: string,
    updates: Partial<PaymentTransaction>
  ): Promise<PaymentTransaction> {
    const db = await createAdminDbClient();
    const patch: Record<string, unknown> = {};
    if (updates.amount !== undefined) patch.amount = updates.amount;
    if (updates.status !== undefined)
      patch.status = legacyStatusToPaymentStatus(updates.status);
    if (updates.gateway_transaction_id !== undefined)
      patch.transaction_id = updates.gateway_transaction_id;

    const hasMeta = LEGACY_META_KEYS.some(
      (k) => updates[k] !== undefined
    );
    if (hasMeta || updates.gateway_response !== undefined) {
      // Merge into the existing gateway_response so meta written at
      // creation (session/provider/reference) is not clobbered.
      const { data: current } = await db
        .from("payments")
        .select("gateway_response")
        .eq("id", id)
        .maybeSingle();
      const gw: Record<string, unknown> = {
        ...(current?.gateway_response || {}),
        ...(updates.gateway_response || {}),
      };
      for (const k of LEGACY_META_KEYS) {
        if (updates[k] !== undefined) gw[k] = updates[k];
      }
      patch.gateway_response = gw;
    }

    const { data, error } = await db
      .from("payments")
      .update(patch)
      .eq("id", id)
      .select()
      .single();

    if (error)
      throw new Error(`Failed to update transaction: ${error.message}`);
    return paymentRowToLegacyTransaction(data) as PaymentTransaction;
  }

  /**
   * Webhooks
   */
  async createWebhookEvent(
    webhook: Partial<PaymentWebhook>
  ): Promise<PaymentWebhook> {
    const db = await createAdminDbClient();
    // FIX ROUND 28 (M-2): payment_webhooks real columns are
    // (id, gateway, payload, status, created_at) — provider_id /
    // event_type / processed_at do not exist. The gateway name is
    // resolved from the provider row; the event type is preserved
    // inside the payload rather than dropped.
    let gateway = "unknown";
    if (webhook.provider_id) {
      const { data: prov } = await db
        .from("payment_providers")
        .select("code")
        .eq("id", webhook.provider_id)
        .maybeSingle();
      if (prov?.code) gateway = String(prov.code);
    }
    const { data, error } = await db
      .from("payment_webhooks")
      .insert({
        gateway,
        payload: {
          ...(webhook.payload || {}),
          __event_type: webhook.event_type ?? null,
        },
        status: webhook.status || "received",
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to log webhook: ${error.message}`);
    return data as PaymentWebhook;
  }

  async updateWebhookEvent(
    id: string,
    updates: Partial<PaymentWebhook>
  ): Promise<PaymentWebhook> {
    const db = await createAdminDbClient();
    // Only `status` is a real updatable column (no processed_at).
    const patch: Record<string, unknown> = {};
    if (updates.status !== undefined) patch.status = updates.status;
    const { data, error } = await db
      .from("payment_webhooks")
      .update(patch)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update webhook: ${error.message}`);
    return data as PaymentWebhook;
  }

  /**
   * Refunds.
   * FIX ROUND 28 (M-2): payment_refunds real columns are
   * (id, payment_id, order_id, amount, reason, status, created_at).
   * The legacy `transaction_id` maps to payment_id; order_id is
   * resolved from the payment row. gateway_refund_id /
   * gateway_response / requested_by / processed_* have no columns in
   * this schema and cannot persist — they are dropped explicitly here
   * rather than silently by the builder.
   */
  async createRefund(refund: Partial<PaymentRefund>): Promise<PaymentRefund> {
    const db = await createAdminDbClient();
    let orderId: string | null = null;
    if (refund.transaction_id) {
      const { data: pay } = await db
        .from("payments")
        .select("order_id")
        .eq("id", refund.transaction_id)
        .maybeSingle();
      orderId = pay?.order_id ?? null;
    }
    const { data, error } = await db
      .from("payment_refunds")
      .insert({
        payment_id: refund.transaction_id,
        order_id: orderId,
        amount: refund.amount,
        reason: refund.reason,
        status: refund.status || "pending",
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create refund: ${error.message}`);
    return { ...data, transaction_id: data.payment_id } as PaymentRefund;
  }

  async updateRefund(
    id: string,
    updates: Partial<PaymentRefund>
  ): Promise<PaymentRefund> {
    const db = await createAdminDbClient();
    const patch: Record<string, unknown> = {};
    if (updates.status !== undefined) patch.status = updates.status;
    if (updates.amount !== undefined) patch.amount = updates.amount;
    if (updates.reason !== undefined) patch.reason = updates.reason;
    const { data, error } = await db
      .from("payment_refunds")
      .update(patch)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update refund: ${error.message}`);
    return { ...data, transaction_id: data.payment_id } as PaymentRefund;
  }

  async getRefundsByTransactionId(
    transactionId: string
  ): Promise<PaymentRefund[]> {
    const db = await createAdminDbClient();
    const { data, error } = await db
      .from("payment_refunds")
      .select("*")
      .eq("payment_id", transactionId);

    if (error) {
      return [];
    }
    return (data || []).map((r: PaymentRefundLedgerRow) => ({
      ...r,
      transaction_id: r.payment_id,
    })) as PaymentRefund[];
  }

  /**
   * Audit Logs.
   * FIX ROUND 28 (M-2): payment_audit_logs real columns are
   * (id, payment_id, action, details, created_at) — the entity link is
   * payment_id; entity_type/user context rides inside details.
   */
  async createAuditLog(
    log: Partial<PaymentAuditLog> & { details?: Record<string, unknown> }
  ): Promise<void> {
    const db = await createAdminDbClient();
    const { error } = await db.from("payment_audit_logs").insert({
      payment_id: log.entity_id ?? null,
      action: log.action,
      details: {
        ...(log.details || {}),
        entity_type: log.entity_type ?? null,
        user_id: log.user_id ?? null,
      },
    });

    if (error) throw new Error(`Failed to create audit log: ${error.message}`);
  }
}

export const paymentRepository = new PaymentRepository();
