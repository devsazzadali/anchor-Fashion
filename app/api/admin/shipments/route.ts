import { NextResponse } from "next/server";
import { createAdminDbClient } from "@/lib/db/client";
import { CourierFactory } from "@/lib/couriers/courier.factory";
import { CourierError } from "@/lib/couriers/errors";
import { verifyStaff } from "@/lib/security/roles";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await verifyStaff();

    const body = await req.json();
    const { orderId, courierId, weight = 0.5, note } = body;

    if (!orderId || !courierId) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: orderId, courierId" },
        { status: 400 }
      );
    }

    const adminDb = createAdminDbClient();

    // 1. Fetch Order
    // Phase 8: orders store the address as a shipping_address JSON column
    // — there is no shipping_address_id relation to embed. The old select
    // made EVERY lookup fail, so this route 404'd for every real order.
    const { data: order, error: orderError } = await adminDb
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .maybeSingle();

    if (orderError || !order) {
      return NextResponse.json(
        { success: false, error: "Order not found" },
        { status: 404 }
      );
    }

    // 2. Address validation
    const addr = order.shipping_address;
    const addressLine1 =
      addr?.address_line1 || addr?.address_line_1 || addr?.address || "";
    if (!addr || !addressLine1 || !addr.phone || !addr.first_name) {
      return NextResponse.json(
        { success: false, error: "Order is missing complete shipping address or recipient phone" },
        { status: 400 }
      );
    }

    // 3. Idempotency Check: prevent duplicate active shipments
    const { data: existingActive } = await adminDb
      .from("shipments")
      .select("id, status")
      .eq("order_id", orderId)
      .neq("status", "cancelled");

    if (existingActive && existingActive.length > 0) {
      return NextResponse.json(
        { success: false, error: "An active shipment already exists for this order." },
        { status: 409 }
      );
    }

    // 4. Resolve courier provider
    const { provider, record: courierRecord } =
      await CourierFactory.getProviderFromDatabase(courierId);

    if (!courierRecord.is_active) {
      return NextResponse.json(
        { success: false, error: "Selected courier provider is currently disabled." },
        { status: 400 }
      );
    }

    if (!provider.isConfigured()) {
      return NextResponse.json(
        { success: false, error: "Courier credentials are not configured." },
        { status: 400 }
      );
    }

    // 5. Calculate COD
    // Phase 8: payment_status is stored UPPERCASE and the amount column
    // is total_amount (grand_total does not exist on orders).
    const paymentStatus = String(order.payment_status || "").toUpperCase();
    const isCOD =
      String(order.payment_method || "").toUpperCase() === "COD" ||
      paymentStatus === "UNPAID" ||
      paymentStatus === "PENDING";
    const codAmount = isCOD ? Number(order.total_amount || 0) : 0;
    const recipientName = `${addr.first_name || ""} ${addr.last_name || ""}`.trim();
    const addressLine2 = addr.address_line2 || addr.address_line_2 || "";

    // 6. Submit consignment to provider API
    const shipmentResult = await provider.createShipment({
      orderId: order.id,
      invoiceNumber: order.order_number || order.id,
      recipientName,
      recipientPhone: addr.phone,
      recipientAddress: `${addressLine1}${addressLine2 ? `, ${addressLine2}` : ""}`,
      recipientCity: addr.city || "Dhaka",
      recipientZone: addr.state || "Dhaka",
      weightKg: Number(weight) || 0.5,
      codAmount,
      isCOD,
      specialInstructions: note || order.delivery_instructions,
    });

    // 7. Save shipment to DB
    // (shipments has no courier_provider_id or consignment_id column —
    // the courier reference is courier_provider_code + tracking_number.)
    const { data: newShipment, error: insertError } = await adminDb
      .from("shipments")
      .insert({
        order_id: order.id,
        courier_provider_code: provider.code,
        status: "created",
        tracking_number: shipmentResult.trackingCode,
        recipient_name: recipientName,
        recipient_phone: addr.phone,
        recipient_address: addressLine1,
        recipient_city: addr.city,
        recipient_district: addr.state,
        is_cod: isCOD,
        cod_amount: codAmount,
        weight_kg: Number(weight) || 0.5,
        special_instructions: note,
        created_by: user.id,
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(`Failed to persist shipment in database: ${insertError.message}`);
    }

    // 8. Create initial tracking event
    await adminDb.from("shipment_tracking_events").insert({
      shipment_id: newShipment.id,
      tracking_number: shipmentResult.trackingCode,
      status: "created",
      status_description: "Consignment created with courier partner",
      provider_raw: (shipmentResult.rawResponse as any) || {},
    });

    // 9. Update order status if OMS requires it
    await adminDb
      .from("orders")
      .update({ status: "ready_for_shipment" })
      .eq("id", order.id);

    return NextResponse.json({
      success: true,
      message: "Shipment created successfully",
      data: {
        shipment: newShipment,
        consignmentId: shipmentResult.consignmentId,
        trackingCode: shipmentResult.trackingCode,
      },
    });
  } catch (err: any) {
    console.error("[CreateShipment API Error]:", err);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: err instanceof CourierError ? err.name : "SHIPMENT_CREATION_FAILED",
          message: err.message || "Failed to create shipment",
        },
      },
      { status: 500 }
    );
  }
}
