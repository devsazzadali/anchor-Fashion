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

    // 3. Log webhook event. FIX ROUND 28 (B-1): courier_webhook_events
    // has ONLY (id, courier, event_type, payload, created_at) — the old
    // insert carried courier_code/event_id/processed/processed_at, none
    // of which exist, so the builder discarded the whole row. (True
    // idempotency needs an event_id column — see the Round-28 DDL
    // proposal; until then events are logged, not deduplicated.)
    try {
      await adminDb.from("courier_webhook_events").insert({
        courier: "pathao",
        event_type: String(parsed.status || "STATUS_UPDATE"),
        payload: rawPayload,
      });
    } catch (e) {
    }

    // 4. Find matching shipment — bound equality lookups only. The raw
    // payload value is never interpolated into a filter string (the old
    // `.or()` template let a crafted consignment id inject extra filter
    // clauses and match shipments it should never have touched).
    // FIX ROUND 28 (B-1): shipments has NO consignment_id column — the
    // old `.eq("consignment_id", …)` poisoned the query (unknown column
    // → empty success), so the shipment was never found and the handler
    // returned 200 having updated nothing. The courier's consignment id
    // is what booking stores as the shipment's tracking_number (fall
    // back to shipment_number); the consignment_id storage column is an
    // owner schema decision (Round-28 DDL proposal).
    let shipment = null;
    {
      const byTracking = await adminDb
        .from("shipments")
        .select("id, status, order_id")
        .eq("tracking_number", parsed.consignmentId)
        .maybeSingle();
      shipment = byTracking.data;
      if (!shipment) {
        const byNumber = await adminDb
          .from("shipments")
          .select("id, status, order_id")
          .eq("shipment_number", parsed.consignmentId)
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
            `Status updated via Pathao webhook: ${parsed.status}`,
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
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message || "Webhook processing error" },
      { status: 500 }
    );
  }
}
