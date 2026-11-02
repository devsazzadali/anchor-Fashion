import { NextResponse } from "next/server";
import { createAdminDbClient } from "@/lib/db/client";
import { CourierFactory } from "@/lib/couriers/courier.factory";
import { verifyStaff } from "@/lib/security/roles";
import { authErrorResponse } from "@/lib/api/auth-error";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ shipmentId: string }> }
) {
  try {
    await verifyStaff();

    const { shipmentId } = await params;
    const adminDb = createAdminDbClient();

    // 1. Fetch shipment.
    // REG-83: the aliased embed order:order_id(...) never attaches (not a
    // supported relation pair), so the response's shipment.order was
    // always missing. Fetch the order explicitly and attach it under the
    // same key with the same columns the embed used to promise.
    const { data: shipmentRow, error: shipError } = await adminDb
      .from("shipments")
      .select("*")
      .eq("id", shipmentId)
      .maybeSingle();

    if (shipError || !shipmentRow) {
      return NextResponse.json(
        { success: false, error: "Shipment not found" },
        { status: 404 }
      );
    }

    let orderSummary: Record<string, unknown> | null = null;
    if (shipmentRow.order_id) {
      const { data: orderRow } = await adminDb
        .from("orders")
        .select("order_number, id, grand_total, payment_method")
        .eq("id", shipmentRow.order_id)
        .maybeSingle();
      orderSummary = orderRow || null;
    }
    const shipment = { ...shipmentRow, order: orderSummary };

    // 2. Fetch existing tracking events.
    // FIX ROUND 28 (M-11): shipment_tracking_events has no created_at
    // column — its time column is `timestamp`; ordering by created_at
    // poisoned the read and events always came back [].
    const { data: events } = await adminDb
      .from("shipment_tracking_events")
      .select("*")
      .eq("shipment_id", shipmentId)
      .order("timestamp", { ascending: true });

    // 3. Optional live sync from provider if a tracking number is present.
    // (FIX ROUND 28: shipments has no consignment_id column — the
    // courier's consignment id is stored as tracking_number.)
    const url = new URL(req.url);
    const sync = url.searchParams.get("sync") === "true";

    if (sync && shipment.courier_provider_code && shipment.tracking_number) {
      try {
        const { provider } = await CourierFactory.getProviderFromDatabase(
          shipment.courier_provider_code
        );

        if (provider.isConfigured()) {
          const liveTracking = await provider.getTracking(
            shipment.tracking_number
          );

          if (liveTracking.currentStatusNormalized !== "unknown") {
            // Update shipment status if changed
            if (liveTracking.currentStatusNormalized !== shipment.status) {
              await adminDb
                .from("shipments")
                .update({
                  status: liveTracking.currentStatusNormalized,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", shipment.id);
            }
          }
        }
      } catch (syncErr) {
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        shipment,
        currentStatus: shipment.status,
        trackingCode: shipment.tracking_number,
        events: events || [],
      },
    });
  } catch (err) {
    return authErrorResponse(err);
  }
}
