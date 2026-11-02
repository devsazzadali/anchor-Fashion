import { NextResponse } from "next/server";
import { createAdminDbClient } from "@/lib/db/client";
import { CourierFactory } from "@/lib/couriers/courier.factory";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // 1. Cron authentication
  const authHeader = req.headers.get("authorization");
  if (
    !process.env.CRON_SECRET ||
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const adminDb = createAdminDbClient();

    // 2. Fetch active shipments needing synchronization
    // FIX ROUND 28 (B-1 class): shipments has no consignment_id column
    // — the courier consignment id is stored as tracking_number.
    const { data: activeShipments, error: fetchError } = await adminDb
      .from("shipments")
      .select("id, courier_provider_code, tracking_number, status, order_id")
      .in("status", ["pickup_requested", "picked_up", "in_transit", "out_for_delivery"])
      .not("courier_provider_code", "is", null)
      .limit(25);

    if (fetchError || !activeShipments || activeShipments.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No active shipments requiring courier synchronization",
        syncedCount: 0,
      });
    }

    let syncedCount = 0;
    const errors: Array<{ shipmentId: string; error: string }> = [];

    // Group shipments by courier code to reuse providers
    const providerCache = new Map<string, any>();

    for (const shipment of activeShipments) {
      const code = shipment.courier_provider_code;
      const trackingIdentifier = shipment.tracking_number;

      if (!code || !trackingIdentifier) continue;

      try {
        if (!providerCache.has(code)) {
          const { provider } = await CourierFactory.getProviderFromDatabase(code);
          providerCache.set(code, provider);
        }

        const provider = providerCache.get(code);
        if (!provider.isConfigured()) continue;

        const liveTracking = await provider.getTracking(trackingIdentifier);

        if (
          liveTracking.currentStatusNormalized !== "unknown" &&
          liveTracking.currentStatusNormalized !== shipment.status
        ) {
          // Update DB status.
          // FIX ROUND 28 (sweep, B-1 class): shipments has no
          // provider_status column — the normalized status is the
          // record; the provider's raw status string goes into the
          // tracking event's notes below.
          await adminDb
            .from("shipments")
            .update({
              status: liveTracking.currentStatusNormalized,
              updated_at: new Date().toISOString(),
            })
            .eq("id", shipment.id);

          // Add tracking event (real columns: shipment_id, status,
          // timestamp, location, notes — tracking_number /
          // status_description / created_at do not exist here).
          await adminDb.from("shipment_tracking_events").insert({
            shipment_id: shipment.id,
            status: liveTracking.currentStatusNormalized,
            timestamp: new Date().toISOString(),
            location: null,
            notes: `Status updated via scheduled courier sync: ${liveTracking.currentStatus}`,
          });

          // Update order if delivered
          if (liveTracking.currentStatusNormalized === "delivered" && shipment.order_id) {
            await adminDb
              .from("orders")
              .update({ status: "delivered", delivered_at: new Date().toISOString() })
              .eq("id", shipment.order_id);
          }

          syncedCount++;
        }
      } catch (err) {
        errors.push({ shipmentId: shipment.id, error: (err as Error).message });
      }
    }

    return NextResponse.json({
      success: true,
      syncedCount,
      totalChecked: activeShipments.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message || "Courier sync cron error" },
      { status: 500 }
    );
  }
}
