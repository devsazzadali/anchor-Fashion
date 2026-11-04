import { NextRequest, NextResponse } from "next/server";
import { createAdminDbClient } from "@/lib/db/client";
import { SSLCommerzService } from "@/lib/services/payment/sslcommerz.service";
import { recordGatewayTransaction } from "@/lib/payments/order-payment-record";
import { CartService } from "@/lib/services/cart.service";
import { CouponService } from "@/services/coupon.service";

export const dynamic = "force-dynamic";

/**
 * SSLCommerz IPN (Instant Payment Notification) Webhook Endpoint
 * Server-to-server notification sent asynchronously by SSLCommerz.
 * Must validate the transaction with validationserverAPI.php, verify amount/currency,
 * and update order/inventory states idempotently.
 */
export async function POST(req: NextRequest) {
  try {
    let payload: Record<string, any> = {};
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await req.formData();
      for (const [key, value] of formData.entries()) {
        payload[key] = typeof value === "string" ? value : String(value);
      }
    } else if (contentType.includes("application/json")) {
      payload = await req.json();
    } else {
      const text = await req.text();
      const urlParams = new URLSearchParams(text);
      for (const [key, value] of urlParams.entries()) {
        payload[key] = value;
      }
    }

    const valId = payload.val_id;
    const tranId = payload.tran_id;
    const status = (payload.status || "").toUpperCase();

    if (!valId || !tranId) {
      return NextResponse.json(
        { error: "Missing required parameters (val_id, tran_id)" },
        { status: 400 }
      );
    }

    const db = createAdminDbClient();

    // 1. Locate Order and Payment Session
    let order = null;
    let paymentSession = null;

    if (payload.value_a) {
      const { data: orderById } = await db
        .from("orders")
        .select("*")
        .eq("id", payload.value_a)
        .maybeSingle();
      if (orderById) order = orderById;
    }

    if (!order && tranId) {
      const { data: sessionData } = await db
        .from("payment_sessions")
        .select("*")
        .filter("metadata->>tran_id", "eq", tranId)
        .maybeSingle();

      if (sessionData) {
        paymentSession = sessionData;
        // REG-83: orders(*) never attaches on payment_sessions — resolve
        // the order explicitly by the session's order_id.
        if (sessionData.order_id) {
          const { data: sessionOrder } = await db
            .from("orders")
            .select("*")
            .eq("id", sessionData.order_id)
            .maybeSingle();
          if (sessionOrder) {
            order = sessionOrder;
          }
        }
      }
    }

    if (!order && tranId) {
      const { data: orderByIntent } = await db
        .from("orders")
        .select("*")
        .or(`payment_intent_id.eq.${tranId},order_number.eq.${tranId}`)
        .maybeSingle();

      if (orderByIntent) order = orderByIntent;
    }

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // A3-A1: if the order was located via value_a / intent fallback, the
    // payment session for this tran_id may not have been resolved yet —
    // resolve it now; the failure-branch gate below binds against it.
    if (!paymentSession && tranId) {
      const { data: sessionData } = await db
        .from("payment_sessions")
        .select("*")
        .filter("metadata->>tran_id", "eq", tranId)
        .maybeSingle();
      if (sessionData) paymentSession = sessionData;
    }

    // 2. Idempotency Guard: If order is already paid/confirmed, acknowledge immediately
    const isAlreadyPaid =
      order.status === "CONFIRMED" ||
      order.status === "PROCESSING" ||
      order.status === "confirmed" ||
      order.status === "processing" ||
      order.payment_status === "CAPTURED";

    if (isAlreadyPaid) {
      return NextResponse.json({
        status: "ALREADY_PROCESSED",
        message: "Payment has already been processed and order confirmed",
        orderId: order.id,
      });
    }

    // Helper for safe rollback
    const safeRollback = async () => {
      try {
        await db.rpc("release_order_inventory", { p_order_id: order.id });
      } catch (_) {}
      try {
        await CouponService.releaseCoupon(order.id);
      } catch (_) {}
    };

    // A3-A1: a FAILED/CANCELLED notification is destructive (cancels the
    // order, releases inventory + coupon), so it must be authenticated
    // BEFORE any state change: (1) tran_id must be bound to a real
    // payment_session belonging to THIS order, and (2) the payload's
    // verify_sign must validate against the store password. An
    // unauthenticated failure post is rejected with NO state change —
    // previously this branch ran before any gateway validation, so
    // anyone who could guess an order number could mass-cancel the
    // day's pending orders.
    const isValidatedFailureNotification = async (): Promise<boolean> => {
      try {
        if (!paymentSession || paymentSession.order_id !== order.id) {
          return false;
        }
        const sessionTranId = (paymentSession.metadata)?.tran_id;
        if (!sessionTranId || sessionTranId !== tranId) return false;
        if (!payload.verify_sign || !payload.verify_key) return false;
        const config = await SSLCommerzService.getConfig();
        return SSLCommerzService.verifySignature(payload, config.store_passwd);
      } catch {
        return false;
      }
    };

    // 3. Handle Failure or Cancellation notifications from IPN
    if (status === "FAILED" || status === "CANCELLED") {
      if (!(await isValidatedFailureNotification())) {
        return NextResponse.json(
          {
            status: "IGNORED",
            error: "Failure notification could not be validated; no state changed",
          },
          { status: 401 }
        );
      }

      await safeRollback();

      await db
        .from("orders")
        .update({ status: "cancelled", payment_status: "FAILED" })
        .eq("id", order.id);

      if (paymentSession?.id) {
        await db
          .from("payment_sessions")
          .update({ status: status.toLowerCase() })
          .eq("id", paymentSession.id);
      }

      return NextResponse.json({
        status: "ACKNOWLEDGED",
        message: `Order marked as ${status.toLowerCase()}`,
      });
    }

    // 4. Authoritative Server-Side Validation via official validationserverAPI.php
    const valRes = await SSLCommerzService.validateTransaction(valId, tranId);

    if (valRes.status !== "VALID" && valRes.status !== "VALIDATED") {
      // A3-A1: a rejected validation proves nothing about the order — a
      // forged val_id lands here too. Do NOT cancel the order or release
      // inventory/coupon on an unvalidated notification; the order stays
      // pending_payment and expires by its reservation window.
      return NextResponse.json(
        { error: "Validation server rejected transaction" },
        { status: 400 }
      );
    }

    // Authoritative Amount Verification
    const gatewayAmount = parseFloat(valRes.amount);
    const orderAmount = parseFloat(order.total_amount ?? order.grand_total ?? 0);
    if (isNaN(gatewayAmount) || Math.abs(gatewayAmount - orderAmount) > 0.01) {

      await safeRollback();

      await db
        .from("orders")
        .update({ status: "cancelled", payment_status: "FAILED" })
        .eq("id", order.id);

      return NextResponse.json({ error: "Amount mismatch" }, { status: 400 });
    }

    // Authoritative Currency Verification
    const verifiedCurrency = (valRes.currency || "").toUpperCase();
    const expectedCurrency = (order.currency || "BDT").toUpperCase();
    const isCurrencyMatch =
      verifiedCurrency === expectedCurrency ||
      (verifiedCurrency === "BDT" && (expectedCurrency === "USD" || expectedCurrency === "BDT"));

    if (!isCurrencyMatch) {

      await safeRollback();

      await db
        .from("orders")
        .update({ status: "cancelled", payment_status: "FAILED" })
        .eq("id", order.id);

      return NextResponse.json({ error: "Currency mismatch" }, { status: 400 });
    }

    const confirmedTrxId = valRes.bank_tran_id || valId;
    const nowIso = new Date().toISOString();

    const { data: provider } = await db
      .from("payment_providers")
      .select("id")
      .eq("code", "sslcommerz")
      .maybeSingle();

    // 5. Record the transaction on the real payments ledger
    // (idempotent per gateway transaction id). FIX ROUND 28 (M-2): the
    // old insert targeted the nonexistent payment_transactions table —
    // after a fully validated payment the ledger row was silently
    // dropped. recordGatewayTransaction logs a durable server error if
    // the write ever fails instead of dropping silently.
    await recordGatewayTransaction(db, {
      orderId: order.id,
      sessionId: paymentSession?.id || null,
      providerId: provider?.id || null,
      userId: order.customer_id || order.user_id || null,
      amount: Number(order.total_amount ?? order.grand_total ?? 0),
      method: "SSLCOMMERZ",
      currency: expectedCurrency,
      status: "SUCCESS",
      referenceNumber: tranId || order.order_number,
      gatewayTransactionId: confirmedTrxId,
      gatewayResponse: valRes,
    });

    if (paymentSession?.id) {
      await db
        .from("payment_sessions")
        .update({
          status: "completed",
          metadata: {
            ...(paymentSession.metadata || {}),
            val_id: valId,
            bank_tran_id: valRes.bank_tran_id,
            card_type: valRes.card_type,
          },
        })
        .eq("id", paymentSession.id);
    }

    // Check if order was cancelled while payment was pending (Late Payment Callback Race)
    if ((order.status || "").toLowerCase() === "cancelled") {

      await db.from("orders").update({
        payment_method: "SSLCOMMERZ",
        payment_status: "REFUND_PENDING",
        payment_intent_id: confirmedTrxId,
        paid_at: nowIso,
      }).eq("id", order.id);

      await db.from("order_status_history").insert({
        order_id: order.id,
        status: "cancelled",
        notes: `Late IPN captured TrxID ${confirmedTrxId} for cancelled order. Marked for refund.`,
        changed_by: order.customer_id || order.user_id || null,
      });

      return NextResponse.json({
        status: "ORDER_ALREADY_CANCELLED",
        message: "Payment captured for cancelled order. Order remains cancelled and marked for refund.",
        trxID: confirmedTrxId,
      });
    }

    // Update order status to confirmed
    const capturePayload: Record<string, any> = {
      status: "confirmed",
      paid_at: nowIso,
      payment_intent_id: confirmedTrxId,
    };

    const { error: captureErr } = await db
      .from("orders")
      .update({
        ...capturePayload,
        payment_method: "SSLCOMMERZ",
        payment_status: "CAPTURED",
      })
      .eq("id", order.id);

    if (captureErr) {
      await db.from("orders").update(capturePayload).eq("id", order.id);
    }

    // Record order status history
    await db.from("order_status_history").insert({
      order_id: order.id,
      status: "confirmed",
      notes: `Paid successfully via SSLCommerz IPN (${valRes.card_type || "Cards/Mobile Banking"}). TrxID: ${confirmedTrxId}, ValID: ${valId}`,
      changed_by: order.customer_id || order.user_id || null,
    });

    // Authoritative Admin Notification for captured payment via IPN
    try {
      const { createOrderNotificationAction } = await import("@/lib/actions/admin/notification.actions");
      await createOrderNotificationAction({
        orderId: order.id,
        orderNumber: order.order_number,
        customerName: order.customer_name || "Online Customer",
        amount: order.total_amount ?? order.grand_total,
        paymentMethod: "SSLCOMMERZ (IPN)",
        status: "confirmed",
      });
    } catch (notifErr) {
    }

    // Clear cart
    try {
      let cartIdToClear: string | null = null;
      if (order.session_id) {
        const { data: cart } = await db
          .from("carts")
          .select("id")
          .eq("session_id", order.session_id)
          .maybeSingle();
        if (cart?.id) cartIdToClear = cart.id;
      }
      if (!cartIdToClear && order.user_id) {
        const { data: userCart } = await db
          .from("carts")
          .select("id")
          .eq("user_id", order.user_id)
          .maybeSingle();
        if (userCart?.id) cartIdToClear = userCart.id;
      }
      if (cartIdToClear) {
        await CartService.clearCart(cartIdToClear);
      }
    } catch (cartErr) {
    }

    // Trigger Order Confirmation SMS asynchronously
    try {
      const { AlphaSmsService } = await import("@/lib/services/sms/alpha-sms.service");
      AlphaSmsService.triggerOrderConfirmationSmsAsync(order.id);
    } catch (smsErr) {
    }

    return NextResponse.json({
      status: "SUCCESS",
      message: "IPN verified and payment processed successfully",
      trxID: confirmedTrxId,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Internal server error processing IPN", details: (error as Error).message },
      { status: 500 }
    );
  }
}
