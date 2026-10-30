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
    // ── Webhook authenticity (REG-70: fail CLOSED) ─────────────────────
    // This handler previously processed ANY unauthenticated POST: when
    // the Pathao provider wasn't resolved from the DB it trusted the raw
    // payload and applied shipment/order status updates from it, so
    // anyone who knew or guessed a consignment id could forge a
    // delivery. The caller must now present the configured
    // PATHAO_WEBHOOK_SECRET (header `x-webhook-secret` or `?token=`),
    // and the call is rejected before any parsing or mutation when the
    // secret is unset or wrong.
    const webhookSecret = process.env.PATHAO_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error(
        "[PathaoWebhook] REJECTED: PATHAO_WEBHOOK_SECRET is not set — refusing to process an unverifiable webhook call. Set the secret and register the webhook URL with the matching token/header to enable Pathao status updates."
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
    const headersList: Record<string, string> = {};
    req.headers.forEach((value, key) => {
      headersList[key.toLowerCase()] = value;
    });

    const adminDb = createAdminDbClient();

    // 1. Resolve Pathao provider
    let provider;
    try {
      const resolved = await CourierFactory.getProviderFromDatabase("pathao");
      provider = resolved.provider;
    } catch {
      // Provider not in DB or error
    }

    // 2. Parse & validate webhook
    const parsed = provider?.handleWebhook
      ? await provider.handleWebhook(rawPayload, headersList)
      : {
          success: true,
          handled: true,
          consignmentId: rawPayload.consignment_id || rawPayload.consignmentId,
          trackingCode: rawPayload.consignment_id || rawPayload.consignmentId,
          status: rawPayload.order_status || rawPayload.order_status_slug,
          eventTime: rawPayload.updated_at || new Date().toISOString(),
          message: "Pathao webhook status update",
          rawPayload,
        };

    if (!parsed.consignmentId) {
      return NextResponse.json(
        { success: false, message: "Missing consignment identifier" },
        { status: 400 }
      );
    }
    // REG-70: strictly validate the identifier's format before it is used
    // anywhere — a payload value must never be able to alter a query.
    if (!isValidConsignmentId(String(parsed.consignmentId))) {
      return NextResponse.json(
        { success: false, message: "Invalid consignment identifier" },
        { status: 400 }
      );
    }

    const eventId = `pathao_${parsed.consignmentId}_${parsed.status}_${Date.now()}`;

    // 3. Log webhook event idempotently
    try {
      await adminDb.from("courier_webhook_events").insert({
        courier_code: "pathao",
        event_type: String(parsed.status || "STATUS_UPDATE"),
        event_id: eventId,
        payload: rawPayload as any,
        processed: true,
        processed_at: new Date().toISOString(),
      });
    } catch (e: any) {
      console.warn("[PathaoWebhook] Warning logging webhook event:", e.message);
    }

    // 4. Find matching shipment — bound equality lookups only. The raw
    // payload value is never interpolated into a filter string (the old
    // `.or()` template let a crafted consignment id inject extra filter
    // clauses and match shipments it should never have touched).
    let shipment: any = null;
    {
      const byConsignment = await adminDb
        .from("shipments")
        .select("id, status, order_id")
        .eq("consignment_id", parsed.consignmentId)
        .maybeSingle();
      shipment = byConsignment.data;
      if (!shipment) {
        const byTracking = await adminDb
          .from("shipments")
          .select("id, status, order_id")
          .eq("tracking_number", parsed.consignmentId)
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
          tracking_number: parsed.trackingCode || parsed.consignmentId,
          status: parsed.status,
          status_description: parsed.message || `Status updated via Pathao webhook: ${parsed.status}`,
          provider_raw: rawPayload as any,
          created_at: parsed.eventTime || new Date().toISOString(),
        });

        // 7. Update order fulfillment status if delivered or cancelled
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
      message: "Pathao webhook processed successfully",
    });
  } catch (err: any) {
    console.error("[PathaoWebhook Exception]:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Webhook processing error" },
      { status: 500 }
    );
  }
}
