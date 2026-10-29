import { NextResponse } from "next/server";
import { TrackingService } from "@/services/shipping/tracking.service";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/shipping/track/[trackingNumber]
 * Public tracking endpoint — no authentication required.
 * Used by the customer tracking page.
 *
 * Accepts either a courier tracking number OR an Anchor order number
 * (AF-YYYYMMDD-XXXX) — the only identifier a guest receives at checkout.
 * An order that already has a shipment resolves to that shipment's
 * timeline; an order with no shipment yet returns its order status with
 * an explicit "not shipped yet" state instead of a misleading not-found.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ trackingNumber: string }> }
) {
  const { trackingNumber } = await params;

  if (!trackingNumber || trackingNumber.length < 3) {
    return NextResponse.json(
      { error: "Invalid tracking number" },
      { status: 400 }
    );
  }

  try {
    const trackingService = new TrackingService();
    const timeline = await trackingService.getTrackingTimeline(
      trackingNumber,
      "tracking_number"
    );

    if (timeline) {
      // Cache for 2 minutes — short TTL for near-real-time tracking
      return NextResponse.json(
        { success: true, data: timeline },
        {
          headers: {
            "Cache-Control": "public, max-age=120, stale-while-revalidate=60",
          },
        }
      );
    }

    // Not a courier tracking number — try an order number.
    const order = await prisma.order.findFirst({
      where: {
        orderNumber: { equals: trackingNumber.trim(), mode: "insensitive" },
      },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        createdAt: true,
        totalAmount: true,
      },
    });

    if (order) {
      const shipment = await prisma.shipment.findFirst({
        where: { orderId: order.id },
        orderBy: { createdAt: "desc" },
        select: { trackingNumber: true, status: true },
      });

      if (shipment?.trackingNumber) {
        const shipmentTimeline = await trackingService.getTrackingTimeline(
          shipment.trackingNumber,
          "tracking_number"
        );
        if (shipmentTimeline) {
          return NextResponse.json(
            { success: true, data: shipmentTimeline },
            {
              headers: {
                "Cache-Control":
                  "public, max-age=120, stale-while-revalidate=60",
              },
            }
          );
        }
      }

      return NextResponse.json({
        success: true,
        data: {
          orderInfo: {
            orderNumber: order.orderNumber,
            status: order.status,
            placedAt: order.createdAt.toISOString(),
            totalAmount: order.totalAmount ? Number(order.totalAmount) : null,
            shipped: Boolean(shipment?.trackingNumber),
            trackingNumber: shipment?.trackingNumber ?? null,
          },
        },
      });
    }

    return NextResponse.json(
      { error: "Tracking information not found for this number" },
      { status: 404 }
    );
  } catch (err: any) {
    console.error("[Tracking API] Error:", err);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
