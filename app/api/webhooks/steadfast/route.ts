import { NextResponse } from "next/server";
import { createAdminDbClient } from "@/lib/db/client";
import { CourierFactory } from "@/lib/couriers/courier.factory";
import {
  getPresentedWebhookSecret,
  isValidConsignmentId,
  sharedSecretMatches,
} from "@/lib/webhooks/shared-secret";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    // ── Webhook authenticity (REG-76: fail CLOSED) ─────────────────────
    // This endpoint previously applied shipment/order status updates from
    // ANY unauthenticated POST — anyone who learned a consignment id could
    // forge a "delivered" event. The caller must present the configured
    // STEADFAST_WEBHOOK_SECRET (header `x-webhook-secret` or `?token=`).
    // When the secret is not configured the request is REJECTED, not
    // processed: there is no safe unauthenticated mode. (If Steadfast's
    // dashboard cannot send a custom secret on the owner's plan, the
    // webhook URL registered there must carry the token query parameter.)
    const webhookSecret = process.env.STEADFAST_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error(
        "[SteadfastWebhook] REJECTED: STEADFAST_WEBHOOK_SECRET is not set — refusing to process an unverifiable webhook call. Set the secret and register the webhook URL with the matching token/header to enable courier status updates."
      );
      return NextResponse.json(
        { success: false, message: "Webhook not configured" },
        { status: 401 }
      );
    }
    if (!sharedSecretMatches(getPresentedWebhookSecret(req), webhookSecret)) {
      return NextResponse.json(
        { success: false, message: "Invalid webhook secret" },
        { status: 401 }
      );
    }

    const rawPayload = await req.json();
    const adminDb = createAdminDbClient();

    // 1. Resolve Steadfast provider
    let provider;
    try {
      const resolved = await CourierFactory.getProviderFromDatabase("steadfast");
      provider = resolved.provider;
    } catch {
      // Provider not in DB or error
    }

    // 2. Parse & validate webhook
    const parsed = provider?.handleWebhook
      ? await provider.handleWebhook(rawPayload)
      : {
          success: true,
          handled: true,
          consignmentId: String(rawPayload.consignment_id || rawPayload.consignmentId || ""),
          trackingCode: rawPayload.tracking_code || String(rawPayload.consignment_id || ""),
          status: rawPayload.status,
          eventTime: rawPayload.updated_at || new Date().toISOString(),
          message: "Steadfast webhook status update",
          rawPayload,
        };

    const targetCode = parsed.consignmentId || parsed.trackingCode;
    if (!targetCode) {
      return NextResponse.json(
        { success: false, message: "Missing consignment identifier" },
        { status: 400 }
      );
    }
    // REG-70 (applied here too): never interpolate a payload value into a
    // filter string — strictly validate the identifier's format and look
    // it up with bound equality filters only.
    if (!isValidConsignmentId(targetCode)) {
      return NextResponse.json(
        { success: false, message: "Invalid consignment identifier" },
        { status: 400 }
      );
    }

    const eventId = `steadfast_${targetCode}_${parsed.status}_${Date.now()}`;

    // 3. Log webhook event idempotently
    try {
      await adminDb.from("courier_webhook_events").insert({
        courier_code: "steadfast",
        event_type: String(parsed.status || "STATUS_UPDATE"),
        event_id: eventId,
        payload: rawPayload as any,
        processed: true,
        processed_at: new Date().toISOString(),
      });
    } catch (e: any) {
      console.warn("[SteadfastWebhook] Warning logging webhook event:", e.message);
    }

    // 4. Find matching shipment — bound equality lookups, no filter-string
    // interpolation (try the consignment id, then the tracking number).
    let shipment: any = null;
    {
      const byConsignment = await adminDb
        .from("shipments")
        .select("id, status, order_id")
        .eq("consignment_id", targetCode)
        .maybeSingle();
      shipment = byConsignment.data;
      if (!shipment) {
        const byTracking = await adminDb
          .from("shipments")
          .select("id, status, order_id")
          .eq("tracking_number", targetCode)
          .maybeSingle();
        shipment = byTracking.data;
      }
    }

    if (shipment) {
      // 5. Update shipment status if provided
      if (parsed.status && parsed.status !== "unknown") {
        await adminDb
          .from("shipments")
          .update({
            status: parsed.status,
            provider_status: parsed.status,
            updated_at: new Date().toISOString(),
          })
          .eq("id", shipment.id);

        // 6. Record tracking event
        await adminDb.from("shipment_tracking_events").insert({
          shipment_id: shipment.id,
          tracking_number: targetCode,
          status: parsed.status,
          status_description: parsed.message || `Status updated via Steadfast webhook: ${parsed.status}`,
          provider_raw: rawPayload as any,
          created_at: parsed.eventTime || new Date().toISOString(),
        });

        // 7. Update order fulfillment status if delivered
        if (parsed.status === "delivered" && shipment.order_id) {
          await adminDb
            .from("orders")
            .update({ status: "delivered", delivered_at: new Date().toISOString() })
            .eq("id", shipment.order_id);
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: "Steadfast webhook processed successfully",
    });
  } catch (err: any) {
    console.error("[SteadfastWebhook Exception]:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Webhook processing error" },
      { status: 500 }
    );
  }
}
