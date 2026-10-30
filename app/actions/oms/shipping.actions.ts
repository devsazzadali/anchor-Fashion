"use server";

import { createAdminDbClient } from "@/lib/db/client";
import { CourierProviderCode } from "@/types/shipping.types";
import { ShippingService } from "@/services/shipping/shipping.service";
import { OrderService } from "@/lib/services/oms/order.service";
import { revalidatePath } from "next/cache";
import { getServerSession } from "@/lib/auth/server";
import { isStaffOrManager, getRoleForUser } from "@/lib/security/roles";

export async function dispatchOrderAction(
  orderId: string,
  courierCode: CourierProviderCode
) {
  try {
    const { user } = await getServerSession();

    if (!user) {
      return { success: false, error: "Unauthorized" };
    }

    const isStaff = await isStaffOrManager(user);
    if (!isStaff) {
      return { success: false, error: "Unauthorized. Insufficient permissions." };
    }

    const role = await getRoleForUser(user);

    // REG-33: dispatching is an order mutation — SUPPORT is read-only.
    if (String(role || "").toUpperCase().trim() === "SUPPORT") {
      return {
        success: false,
        error: "Support accounts are read-only and cannot dispatch orders.",
      };
    }

    const adminDb = await createAdminDbClient();
    const orderService = new OrderService();
    const shippingService = new ShippingService();

    // 1. Fetch Authoritative Order
    const orderDetails = await orderService.getOrderDetails(orderId, adminDb);
    if (!orderDetails) {
      return { success: false, error: "Order not found" };
    }

    // 2. Validate Order Eligibility
    const ineligibleStatuses = ["cancelled", "refunded", "returned", "failed"];
    if (ineligibleStatuses.includes(orderDetails.status.toLowerCase())) {
      return {
        success: false,
        error: `Order cannot be dispatched because its status is ${orderDetails.status}.`,
      };
    }

    // If COD, ensure it hasn't been flagged by COD fraud shield (Prompt 10)
    // The fraud check blocks order confirmation, so if status is 'draft' or 'pending', we shouldn't dispatch yet.
    if (["draft", "pending", "pending_payment"].includes(orderDetails.status.toLowerCase())) {
      if (orderDetails.payment_method === "COD") {
        return {
          success: false,
          error: "COD order has not been confirmed yet.",
        };
      } else {
         return {
          success: false,
          error: "Pre-paid order has not completed payment.",
        };
      }
    }

    // 3. Address Validation
    const rawAddress = (orderDetails as any).shippingAddress || (orderDetails as any).shipping_address;
    if (!rawAddress) {
      return { success: false, error: "Order is missing shipping address." };
    }

    // Phase 8: the storefront checkout stores the street as
    // "address_line_1" — the parser previously accepted only
    // address_line1/address_line/addressLine/address, so dispatch
    // rejected EVERY storefront order as "missing address" before any
    // courier logic ran.
    const addressLine =
      rawAddress.address_line1 ||
      rawAddress.address_line_1 ||
      rawAddress.address_line ||
      rawAddress.addressLine ||
      rawAddress.address ||
      "";
    const phone = rawAddress.phone || rawAddress.recipient_phone || rawAddress.recipientPhone || "";
    const firstName =
      rawAddress.first_name ||
      rawAddress.firstName ||
      rawAddress.recipient_name ||
      rawAddress.recipientName ||
      rawAddress.name ||
      "";
    const lastName = rawAddress.last_name || rawAddress.lastName || "";

    if (!addressLine || !phone || !firstName) {
      return { success: false, error: "Order is missing complete shipping address, phone, or recipient name." };
    }

    // 4. Idempotency Check (Does an active shipment already exist?)
    // Phase 8: a 'created' draft with no consignment (left behind by a
    // failed submission) must not block a retry — only shipments that
    // actually reached a courier count as active.
    const { data: existingShipments } = await adminDb
      .from("shipments")
      .select("id, status, consignment_id")
      .eq("order_id", orderId)
      .neq("status", "cancelled");

    const activeShipments = (existingShipments || []).filter(
      (s: any) => s.status !== "created" || s.consignment_id
    );

    if (activeShipments.length > 0) {
      return {
        success: false,
        error: "An active shipment already exists for this order.",
      };
    }

    // 5. COD Amount Integrity
    let codAmount = 0;
    let isCOD = false;
    
    // We strictly use the authoritative order state
    if (orderDetails.payment_method === "COD" && orderDetails.payment_status !== "paid") {
       isCOD = true;
       // The amount left to pay
       // Note: total_due might not exist on orderDetails depending on schema, so we fallback to grand_total - paid_amount if possible
       // We'll use grand_total assuming COD means full amount is due on delivery.
       codAmount = Number(orderDetails.grand_total || 0);
    }

    // 5b. Phase 8: courier pre-flight. Fail BEFORE creating any shipment
    // when the chosen courier is not registered or has no credentials.
    // Previously the flow created the shipment, swallowed the provider
    // failure, advanced the order to ready_for_shipment and reported
    // success — a booking that never happened.
    const { prisma } = await import("@/lib/prisma");
    const courierRow = await prisma.courier_providers.findFirst({
      where: { code: courierCode },
    });
    if (!courierRow || courierRow.is_active === false) {
      return {
        success: false,
        error: `Courier "${courierCode}" is not registered or is inactive. Add it under Shipping → Couriers first. No shipment was created.`,
      };
    }
    if (courierCode !== "sandbox") {
      const cfg = (courierRow.config as any) || {};
      const creds = (cfg.credentials as any) || {};
      const apiKey = courierRow.api_key || creds.apiKey || creds.api_key;
      const secretKey =
        courierRow.api_secret || creds.secretKey || creds.secret_key;
      if (!apiKey || !secretKey) {
        return {
          success: false,
          error: `${courierRow.name || courierCode} is not configured — API credentials are missing. Add the API key and secret key in Shipping → Couriers, then try again. No shipment was created.`,
        };
      }
    }

    // 6. Create Shipment
    const recipientName = `${firstName} ${lastName}`.trim();
    const addressLine2 = rawAddress.address_line2 || rawAddress.address_line_2 || rawAddress.addressLine2 || "";
    
    const shipmentInput = {
      orderId: orderId,
      courierProviderCode: courierCode,
      recipientName: recipientName,
      recipientPhone: phone,
      recipientAddress: addressLine + (addressLine2 ? `, ${addressLine2}` : ""),
      recipientCity: rawAddress.city || undefined,
      recipientDistrict: rawAddress.state || rawAddress.district || undefined,
      isCOD: isCOD,
      codAmount: codAmount,
      items: (orderDetails.items || []).map((item: any) => ({
        orderItemId: item.id,
        sku: item.sku,
        productName: item.product_name,
        variantName: item.variant_name || undefined,
        quantity: item.quantity,
        unitPrice: Number(item.unit_price),
      })),
    };

    const newShipment = await shippingService.createShipment(shipmentInput, user.id);

    // 7. Assign Courier & Trigger API
    const assignedShipment = await shippingService.assignCourier(newShipment.id, courierCode, user.id, true);

    // 8. Update Order Fulfillment State
    await orderService.updateOrderStatus(orderId, "ready_for_shipment", user.id, role);

    revalidatePath(`/admin/orders/${orderId}`);
    return { success: true, data: assignedShipment };

  } catch (error: any) {
    console.error("[dispatchOrderAction Error]:", error);
    return { success: false, error: error.message || "Failed to dispatch order" };
  }
}
