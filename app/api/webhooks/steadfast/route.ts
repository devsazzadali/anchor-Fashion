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

    // 3. Log webhook event. FIX ROUND 28 (B-1): courier_webhook_events
    // has ONLY (id, courier, event_type, payload, created_at) — the old
    // insert carried courier_code/event_id/processed/processed_at, none
    // of which exist, so the builder discarded the whole row. (True
    // idempotency needs an event_id column — see the Round-28 DDL
    // proposal; until then events are logged, not deduplicated.)
    try {
      await adminDb.from("courier_webhook_events").insert({
        courier: "steadfast",
        event_type: String(parsed.status || "STATUS_UPDATE"),
        payload: rawPayload,
      });
    } catch (e) {
    }

    // 4. Find matching shipment — bound equality lookups, no filter-string
    // interpolation (try the tracking number, then the shipment number).
    // FIX ROUND 28 (B-1): shipments has NO consignment_id column — the
    // old `.eq("consignment_id", …)` poisoned the query (unknown column
    // → empty success), so the shipment was never found and the handler
    // returned 200 having updated nothing. The courier's consignment id
    // is what booking stores as the shipment's tracking_number; the
    // consignment_id storage column is an owner schema decision
    // (Round-28 DDL proposal).
    let shipment = null;
    {
      const byTracking = await adminDb
        .from("shipments")
        .select("id, status, order_id")
        .eq("tracking_number", targetCode)
        .maybeSingle();
      shipment = byTracking.data;
      if (!shipment) {
        const byNumber = await adminDb
          .from("shipments")
          .select("id, status, order_id")
          .eq("shipment_number", targetCode)
          .maybeSingle();
        shipment = byNumber.data;
      }
    }

    if (shipment) {
      // 5. Update shipment status if provided.
      // FIX ROUND 28 (B-1): provider_status is not a shipments column —
      // its presence made the builder drop the ENTIRE update (including
      // status). Only real columns are written now.
      if (parsed.status && parsed.status !== "unknown") {
        const shipmentUpdate: Record<string, any> = {
          status: parsed.status,
          updated_at: new Date().toISOString(),
        };
        if (parsed.status === "delivered") {
          shipmentUpdate.delivered_at = new Date().toISOString();
        }
        await adminDb
          .from("shipments")
          .update(shipmentUpdate)
          .eq("id", shipment.id);

        // 6. Record tracking event — real shipment_tracking_events
        // columns are (id, shipment_id, status, timestamp, location,
        // notes); the old insert's tracking_number / status_description
        // / provider_raw / created_at columns do not exist and the row
        // was discarded whole.
        await adminDb.from("shipment_tracking_events").insert({
          shipment_id: shipment.id,
          status: parsed.status,
          timestamp: parsed.eventTime || new Date().toISOString(),
          location: null,
          notes:
            parsed.message ||
            `Status updated via Steadfast webhook: ${parsed.status}`,
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
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message || "Webhook processing error" },
      { status: 500 }
    );
  }
}
