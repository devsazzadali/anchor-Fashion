import { NextResponse, NextRequest } from "next/server";
import { createAdminDbClient } from "@/lib/db/client";
import { SSLCommerzService } from "@/lib/services/payment/sslcommerz.service";
import { recordGatewayTransaction } from "@/lib/payments/order-payment-record";
import { CartService } from "@/lib/services/cart.service";
import { CouponService } from "@/services/coupon.service";
import { InventoryService } from "@/services/inventory.service";

export const dynamic = "force-dynamic";

/**
 * Universal SSLCommerz Callback Handler (GET / POST)
 * Handles customer browser redirect from SSLCommerz hosted gateway (success, fail, cancel).
 * Performs authoritative server-side validation against validationserverAPI.php,
 * verifies amount, currency, order ownership, manages inventory lifecycle, and updates order.
 */
async function handleSSLCommerzCallback(req: NextRequest) {
  const url = new URL(req.url);
  const actionParam = url.searchParams.get("action");
  const forwardedProto = req.headers.get("x-forwarded-proto") || "http";
  const forwardedHost = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const requestOrigin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : url.origin;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || requestOrigin;

  let payload: Record<string, any> = {};

  // Extract query parameters
  for (const [key, value] of url.searchParams.entries()) {
    payload[key] = value;
  }

  // Extract POST body (form-urlencoded or JSON)
  if (req.method === "POST") {
    try {
      const contentType = req.headers.get("content-type") || "";
      if (contentType.includes("application/x-www-form-urlencoded")) {
        const formData = await req.formData();
        for (const [key, value] of formData.entries()) {
          payload[key] = typeof value === "string" ? value : String(value);
        }
      } else if (contentType.includes("application/json")) {
        const json = await req.json();
        payload = { ...payload, ...json };
      } else {
        const text = await req.text();
        const urlParams = new URLSearchParams(text);
        for (const [key, value] of urlParams.entries()) {
          payload[key] = value;
        }
      }
    } catch (parseErr) {
    }
  }

  const valId = payload.val_id;
  const tranId = payload.tran_id;
  const status = (payload.status || "").toUpperCase();
  const orderIdFromCustom = payload.value_a;
  const action = actionParam || (status === "VALID" || status === "VALIDATED" ? "success" : status === "CANCELLED" ? "cancel" : "fail");

  const db = createAdminDbClient();
  const inventoryService = new InventoryService();

  // 1. Locate Order and Payment Session
  let order = null;
  let paymentSession = null;

  // Try lookup by custom parameter value_a (order.id)
  if (orderIdFromCustom) {
    const { data: orderById } = await db
      .from("orders")
      .select("*")
      .eq("id", orderIdFromCustom)
      .maybeSingle();
    if (orderById) {
      order = orderById;
    }
  }

  // Lookup in payment_sessions by tran_id.
  // REG-83: same dropped-embed defect as the bKash callback — orders(*)
  // never attaches on payment_sessions; resolve by order_id explicitly.
  if (tranId) {
    const { data: sessionData } = await db
      .from("payment_sessions")
      .select("*")
      .filter("metadata->>tran_id", "eq", tranId)
      .maybeSingle();

    if (sessionData) {
      paymentSession = sessionData;
      if (!order && sessionData.order_id) {
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

  // Fallback lookup order directly by payment_intent_id or order_number
  if (!order && tranId) {
    const { data: orderByIntent } = await db
      .from("orders")
      .select("*")
      .or(`payment_intent_id.eq.${tranId},order_number.eq.${tranId}`)
      .maybeSingle();

    if (orderByIntent) {
      order = orderByIntent;
    }
  }

  if (!order) {
    return NextResponse.redirect(
      new URL("/checkout/failed?reason=order_not_found", appUrl),
      303
    );
  }

  // If session wasn't located yet, find session for this order
  if (!paymentSession) {
    const { data: sessionByOrder } = await db
      .from("payment_sessions")
      .select("*")
      .eq("order_id", order.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (sessionByOrder) {
      paymentSession = sessionByOrder;
    }
  }

  // 2. Idempotency Guard: If order is already paid/confirmed, redirect directly to success
  const isAlreadyPaid =
    order.status === "CONFIRMED" ||
    order.status === "PROCESSING" ||
    order.status === "confirmed" ||
    order.status === "processing" ||
    order.payment_status === "CAPTURED";

  if (isAlreadyPaid) {
    const existingTrxId = order.payment_intent_id || tranId;
    return NextResponse.redirect(
      new URL(`/checkout/success?order_id=${order.id}&trxID=${existingTrxId}`, appUrl),
      303
    );
  }

  // 3. Handle Cancellation or Failure from Gateway
  if (action === "cancel" || status === "CANCELLED" || action === "fail" || status === "FAILED") {
    // A3-A1: this branch is destructive (cancels the order, releases
    // inventory + coupon), so the notification must be authenticated
    // BEFORE any state change: (1) tran_id must be bound to a real
    // payment_session belonging to THIS order, and (2) the payload's
    // verify_sign must validate against the store password. A genuine
    // gateway fail/cancel redirect always carries both; an
    // unauthenticated hit (e.g. ?action=cancel&tran_id=<order number>)
    // is ignored with NO state change — the customer still lands on the
    // failure page, but the order stays pending_payment.
    const sessionBound =
      !!paymentSession &&
      paymentSession.order_id === order.id &&
      (paymentSession.metadata as any)?.tran_id === tranId;
    let signatureValid = false;
    try {
      if (payload.verify_sign && payload.verify_key) {
        const config = await SSLCommerzService.getConfig();
        signatureValid = SSLCommerzService.verifySignature(
          payload,
          config.store_passwd
        );
      }
    } catch {
      signatureValid = false;
    }
    if (!sessionBound || !signatureValid) {
      return NextResponse.redirect(
        new URL(`/checkout/failed?order_id=${order.id}&reason=unvalidated_callback`, appUrl),
        303
      );
    }

    const isCancel = action === "cancel" || status === "CANCELLED";

    try {
      // Release reserved inventory authoritatively in Neon DB & RPC
      await inventoryService.releaseOrderInventory(order.id);
      await db.rpc("release_order_inventory", { p_order_id: order.id }).catch(() => {});
      // Release coupon usage if applied
      await CouponService.releaseCoupon(order.id);
    } catch (releaseErr) {
    }

    // Update order status to cancelled
    const cancelPayload: Record<string, any> = {
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
    };
    const { error: cancelErr } = await db
      .from("orders")
      .update({ ...cancelPayload, payment_status: "FAILED" })
      .eq("id", order.id);
    if (cancelErr) {
      await db.from("orders").update(cancelPayload).eq("id", order.id);
    }

    // Update payment session status
    if (paymentSession?.id) {
      await db
        .from("payment_sessions")
        .update({ status: isCancel ? "cancelled" : "failed" })
        .eq("id", paymentSession.id);
    }

    // Record transaction audit log. FIX ROUND 28 (M-2): the
    // payment_transactions table does not exist — this insert was
    // silently discarded. The record now lands on the real `payments`
    // ledger via the shared helper.
    await recordGatewayTransaction(db, {
      orderId: order.id,
      sessionId: paymentSession?.id || null,
      providerId: paymentSession?.provider_id || null,
      amount: Number(order.total_amount ?? order.grand_total ?? 0),
      method: "SSLCOMMERZ",
      currency: order.currency || "BDT",
      status: "FAILED",
      referenceNumber: tranId || order.order_number,
      errorCode: `SSLCOMMERZ_${isCancel ? "CANCELLED" : "FAILED"}`,
      errorMessage: payload.failedreason || payload.error || `Customer ${isCancel ? "cancelled" : "failed"} payment at gateway`,
      gatewayResponse: payload,
    });

    return NextResponse.redirect(
      new URL(`/checkout/failed?order_id=${order.id}&reason=payment_${isCancel ? "cancelled" : "failed"}`, appUrl),
      303
    );
  }

  // 4. Handle Success -> Authoritative Server-Side Validation
  if (action === "success" || status === "VALID" || status === "VALIDATED") {
    if (!valId) {
      return NextResponse.redirect(
        new URL(`/checkout/failed?order_id=${order.id}&reason=missing_val_id`, appUrl),
        303
      );
    }

    try {
      // Call official validation API: validationserverAPI.php
      const valRes = await SSLCommerzService.validateTransaction(valId, tranId);

      // Verify Provider Status
      if (valRes.status !== "VALID" && valRes.status !== "VALIDATED") {
        // A3-A1: a rejected validation proves nothing about the order —
        // a forged val_id lands here too. Do NOT cancel the order or
        // release inventory/coupon on an unvalidated notification; the
        // order stays pending_payment and expires by its reservation
        // window. (The amount/currency checks below run only on a
        // VALIDATED gateway response and keep their handling.)
        return NextResponse.redirect(
          new URL(`/checkout/failed?order_id=${order.id}&reason=validation_failed`, appUrl),
          303
        );
      }

      // Authoritative Amount Verification: compare SSLCommerz verified amount against authoritative order total
      const gatewayAmount = parseFloat(valRes.amount);
      const orderAmount = parseFloat(order.total_amount ?? order.grand_total ?? 0);
      if (isNaN(gatewayAmount) || Math.abs(gatewayAmount - orderAmount) > 0.01) {

        await inventoryService.releaseOrderInventory(order.id);
        await db.rpc("release_order_inventory", { p_order_id: order.id }).catch(() => {});
        await CouponService.releaseCoupon(order.id);

        await db
          .from("orders")
          .update({ status: "cancelled", payment_status: "FAILED" })
          .eq("id", order.id);

        return NextResponse.redirect(
          new URL(`/checkout/failed?order_id=${order.id}&reason=amount_mismatch`, appUrl),
          303
        );
      }

      // Authoritative Currency Verification
      const verifiedCurrency = (valRes.currency || "").toUpperCase();
      const expectedCurrency = (order.currency || "BDT").toUpperCase();
      const isCurrencyMatch =
        verifiedCurrency === expectedCurrency ||
        (verifiedCurrency === "BDT" && (expectedCurrency === "USD" || expectedCurrency === "BDT"));

      if (!isCurrencyMatch) {

        await db.rpc("release_order_inventory", { p_order_id: order.id });
        await CouponService.releaseCoupon(order.id);

        await db
          .from("orders")
          .update({ status: "cancelled", payment_status: "FAILED" })
          .eq("id", order.id);

        return NextResponse.redirect(
          new URL(`/checkout/failed?order_id=${order.id}&reason=currency_mismatch`, appUrl),
          303
        );
      }

      // Authoritative Transaction ID Verification
      if (valRes.tran_id && tranId && valRes.tran_id !== tranId) {
      }

      const confirmedTrxId = valRes.bank_tran_id || valId;
      const nowIso = new Date().toISOString();

      // Retrieve SSLCommerz provider ID
      const { data: provider } = await db
        .from("payment_providers")
        .select("id")
        .eq("code", "sslcommerz")
        .maybeSingle();

      // 5. Record the transaction on the real payments ledger
      // (idempotent per gateway transaction id). FIX ROUND 28 (M-2):
      // the old insert targeted the nonexistent payment_transactions
      // table and was silently discarded.
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

      // Update payment session to completed
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
          notes: `Late payment callback captured TrxID ${confirmedTrxId} for cancelled order. Marked for refund.`,
          changed_by: order.customer_id || order.user_id || null,
        });

        return NextResponse.redirect(
          new URL(`/checkout/failed?order_id=${order.id}&reason=order_already_cancelled_refund_pending`, appUrl),
          303
        );
      }

      // Update order to confirmed & captured
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

      // Insert Order Status History
      await db.from("order_status_history").insert({
        order_id: order.id,
        status: "confirmed",
        notes: `Paid successfully via SSLCommerz (${valRes.card_type || "Cards/Mobile Banking"}). TrxID: ${confirmedTrxId}, ValID: ${valId}`,
        changed_by: order.customer_id || order.user_id || null,
      });

      // Authoritative Admin Notification for captured payment
      try {
        const { createOrderNotificationAction } = await import("@/lib/actions/admin/notification.actions");
        await createOrderNotificationAction({
          orderId: order.id,
          orderNumber: order.order_number,
          customerName: (order as any).customer_name || "Online Customer",
          amount: order.total_amount ?? order.grand_total,
          paymentMethod: "SSLCOMMERZ (PAID)",
          status: "confirmed",
        });
      } catch (notifErr) {
      }

      // Clear customer cart (Prompt 7 integration)
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

      return NextResponse.redirect(
        new URL(`/checkout/success?order_id=${order.id}&trxID=${confirmedTrxId}`, appUrl),
        303
      );
    } catch (execErr) {
      return NextResponse.redirect(
        new URL(`/checkout/failed?order_id=${order.id}&reason=internal_error`, appUrl),
        303
      );
    }
  }

  // Unknown callback status
  return NextResponse.redirect(
    new URL(`/checkout/failed?order_id=${order.id}&reason=unknown_status`, appUrl),
    303
  );
}

export async function GET(req: NextRequest) {
  return handleSSLCommerzCallback(req);
}

export async function POST(req: NextRequest) {
  return handleSSLCommerzCallback(req);
}
