import { NextResponse, NextRequest } from "next/server";
import { createAdminDbClient } from "@/lib/db/client";
import { BKashService } from "@/lib/services/payment/bkash.service";
import { recordGatewayTransaction } from "@/lib/payments/order-payment-record";
import { CartService } from "@/lib/services/cart.service";
import { CouponService } from "@/services/coupon.service";
import { InventoryService } from "@/services/inventory.service";

export const dynamic = "force-dynamic";

/**
 * Common handler for bKash Tokenized Checkout Callback (GET / POST)
 * Handles customer return from bKash gateway, executes payment, validates amount,
 * and updates order/inventory transactionally.
 */
async function handleCallback(req: NextRequest) {
  const url = new URL(req.url);
  let paymentID = url.searchParams.get("paymentID");
  let status = url.searchParams.get("status");

  // If POST, parameters can also be in body
  if (req.method === "POST" && (!paymentID || !status)) {
    try {
      const body = await req.json();
      paymentID = paymentID || body.paymentID;
      status = status || body.status;
    } catch {
      // Body may not be JSON, fallback to URL searchParams
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  if (!paymentID || !status) {
    return NextResponse.redirect(
      new URL("/checkout/failed?reason=missing_callback_params", appUrl)
    );
  }

  const db = createAdminDbClient();
  const inventoryService = new InventoryService();

  // 1. Locate the Order and Payment Session
  let order = null;
  let paymentSession = null;

  // Check payment_sessions by metadata paymentID.
  // REG-83: the DB builder cannot attach orders(*) on payment_sessions
  // (not a supported relation pair), so sessionData.orders was always
  // undefined and this resolution silently never happened — the handler
  // only ever found orders through the payment_intent_id fallback below.
  // Resolve the order explicitly by the session's order_id.
  const { data: sessionData } = await db
    .from("payment_sessions")
    .select("*")
    .filter("metadata->>paymentID", "eq", paymentID)
    .maybeSingle();

  if (sessionData) {
    paymentSession = sessionData;
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

  // Fallback: lookup order directly by payment_intent_id
  if (!order) {
    const { data: orderData } = await db
      .from("orders")
      .select("*")
      .eq("payment_intent_id", paymentID)
      .maybeSingle();

    if (orderData) {
      order = orderData;
    }
  }

  if (!order) {
    return NextResponse.redirect(
      new URL("/checkout/failed?reason=order_not_found", appUrl)
    );
  }

  // 2. Idempotency Guard: If order is already confirmed / processing / paid, redirect to success
  const isAlreadyPaid =
    order.status === "CONFIRMED" ||
    order.status === "PROCESSING" ||
    order.status === "processing" ||
    order.status === "confirmed" ||
    order.payment_status === "CAPTURED";

  if (isAlreadyPaid) {
    const existingTrxId = order.payment_intent_id || paymentID;
    return NextResponse.redirect(
      new URL(`/checkout/success?order_id=${order.id}&trxID=${existingTrxId}`, appUrl)
    );
  }

  // 3. Handle Cancellation or Failure from Gateway
  if (status === "cancel" || status === "failure") {

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

    // Update session status if exists
    if (paymentSession?.id) {
      await db
        .from("payment_sessions")
        .update({ status: status === "cancel" ? "cancelled" : "failed" })
        .eq("id", paymentSession.id);
    }

    // Record failed transaction log. FIX ROUND 28 (M-2): the
    // payment_transactions table does not exist — this insert was
    // silently discarded. The record now lands on the real `payments`
    // ledger via the shared helper.
    await recordGatewayTransaction(db, {
      orderId: order.id,
      sessionId: paymentSession?.id || null,
      providerId: paymentSession?.provider_id || null,
      amount: Number(order.total_amount ?? order.grand_total ?? 0),
      method: "BKASH",
      currency: "BDT",
      status: "FAILED",
      errorCode: `BKASH_${status.toUpperCase()}`,
      errorMessage: `Customer ${status}ed payment at gateway`,
    });

    return NextResponse.redirect(
      new URL(`/checkout/failed?order_id=${order.id}&reason=bkash_${status}`, appUrl)
    );
  }

  // 4. Handle Success -> Authoritative Server-Side Execution
  if (status === "success") {
    try {
      const executeRes = await BKashService.executePayment(paymentID);

      // Verify Provider Response Code
      if (executeRes.statusCode !== "0000" || executeRes.transactionStatus !== "Completed") {

        // Release inventory on unconfirmed execution
        await inventoryService.releaseOrderInventory(order.id);
        await db.rpc("release_order_inventory", { p_order_id: order.id }).catch(() => {});
        await CouponService.releaseCoupon(order.id);

        const failPayload: Record<string, any> = { status: "cancelled" };
        const { error: failErr } = await db
          .from("orders")
          .update({ ...failPayload, payment_status: "FAILED" })
          .eq("id", order.id);
        if (failErr) {
          await db.from("orders").update(failPayload).eq("id", order.id);
        }

        return NextResponse.redirect(
          new URL(`/checkout/failed?order_id=${order.id}&reason=bkash_execution_failed`, appUrl)
        );
      }

      // Authoritative Amount Verification: check that bKash amount matches order total_amount
      const gatewayAmount = parseFloat(executeRes.amount);
      const orderAmount = parseFloat(order.total_amount ?? order.grand_total ?? 0);
      if (Math.abs(gatewayAmount - orderAmount) > 0.01) {

        await inventoryService.releaseOrderInventory(order.id);
        await db.rpc("release_order_inventory", { p_order_id: order.id }).catch(() => {});
        await CouponService.releaseCoupon(order.id);

        const mismatchPayload: Record<string, any> = { status: "cancelled" };
        const { error: mismatchErr } = await db
          .from("orders")
          .update({ ...mismatchPayload, payment_status: "FAILED" })
          .eq("id", order.id);
        if (mismatchErr) {
          await db.from("orders").update(mismatchPayload).eq("id", order.id);
        }

        return NextResponse.redirect(
          new URL(`/checkout/failed?order_id=${order.id}&reason=amount_mismatch`, appUrl)
        );
      }

      // Authoritative Invoice Verification
      if (executeRes.merchantInvoiceNumber && executeRes.merchantInvoiceNumber !== order.order_number) {
      }

      const trxID = executeRes.trxID || paymentID;
      const nowIso = new Date().toISOString();

      // Retrieve bKash provider ID
      const { data: provider } = await db
        .from("payment_providers")
        .select("id")
        .eq("code", "bkash")
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
        amount: Number(order.total_amount ?? 0),
        method: "BKASH",
        currency: "BDT",
        status: "SUCCESS",
        referenceNumber: order.order_number,
        gatewayTransactionId: trxID,
        gatewayResponse: executeRes,
      });

      // Update payment session to completed
      if (paymentSession?.id) {
        await db
          .from("payment_sessions")
          .update({ status: "completed" })
          .eq("id", paymentSession.id);
      }

      // Check if order was cancelled while payment was pending (Late Payment Callback Race)
      if ((order.status || "").toLowerCase() === "cancelled") {

        await db.from("orders").update({
          payment_method: "BKASH",
          payment_status: "REFUND_PENDING",
          payment_intent_id: trxID,
          paid_at: nowIso,
        }).eq("id", order.id);

        await db.from("order_status_history").insert({
          order_id: order.id,
          status: "cancelled",
          notes: `Late payment callback captured TrxID ${trxID} for cancelled order. Marked for refund.`,
          changed_by: order.customer_id || order.user_id || null,
        });

        return NextResponse.redirect(
          new URL(`/checkout/failed?order_id=${order.id}&reason=order_already_cancelled_refund_pending`, appUrl)
        );
      }

      // Update order to confirmed
      const capturePayload: Record<string, any> = {
        status: "confirmed",
        paid_at: nowIso,
        payment_intent_id: trxID,
      };
      const { error: captureErr } = await db
        .from("orders")
        .update({
          ...capturePayload,
          payment_method: "BKASH",
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
        notes: `Paid successfully via bKash. TrxID: ${trxID}`,
        changed_by: order.customer_id || order.user_id || null,
      });

      // Authoritative Admin Notification for captured bKash payment
      try {
        const { createOrderNotificationAction } = await import("@/lib/actions/admin/notification.actions");
        await createOrderNotificationAction({
          orderId: order.id,
          orderNumber: order.order_number,
          customerName: (order as any).customer_name || "Online Customer",
          amount: order.total_amount ?? order.grand_total,
          paymentMethod: "BKASH (PAID)",
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

      return NextResponse.redirect(
        new URL(`/checkout/success?order_id=${order.id}&trxID=${trxID}`, appUrl)
      );
    } catch (execErr) {
      return NextResponse.redirect(
        new URL(`/checkout/failed?order_id=${order.id}&reason=internal_error`, appUrl)
      );
    }
  }

  // Unknown status
  return NextResponse.redirect(
    new URL(`/checkout/failed?order_id=${order.id}&reason=unknown_status`, appUrl)
  );
}

export async function GET(req: NextRequest) {
  return handleCallback(req);
}

export async function POST(req: NextRequest) {
  return handleCallback(req);
}
