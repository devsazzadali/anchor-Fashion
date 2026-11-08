import { OrderRepository } from "@/lib/repositories/oms/order.repository";
import { OrderItemsRepository } from "@/lib/repositories/oms/order-items.repository";
import { OrderStatusService } from "./order-status.service";
import { Order, OrderStatus } from "@/types/oms";

// NOTE (Phase 11, owner rule 2026-10-29): this service deliberately has NO
// createOrder method. Anchor Fashion has no manual/staff sales — orders are
// created only by customers through the storefront checkout
// (lib/services/order.service.ts → OrderService.placeOrder). This service
// covers staff-side order OPERATIONS only: status transitions and details.

export class OrderService {
  private orderRepo = new OrderRepository();
  private orderItemsRepo = new OrderItemsRepository();
  private statusService = new OrderStatusService();

  async updateOrderStatus(
    id: string,
    newStatus: OrderStatus,
    updatedBy?: string,
    role?: string
  ): Promise<Order> {
    const order = await this.orderRepo.getOrderById(id);
    if (!order) {
      throw new Error("Order not found");
    }

    if (!this.statusService.canTransition(order.status, newStatus, role)) {
      throw new Error(
        `Invalid status transition from ${order.status} to ${newStatus}`
      );
    }

    const updated = await this.orderRepo.updateOrderStatus(id, newStatus, updatedBy);

    // Check for referral qualification and loyalty points
    const lowerStatus = newStatus.toLowerCase();

    // A SHIPPED order must have a shipment record behind it. Transitions
    // that bypass dispatch (manual status updates, webhook sync) used to
    // leave orders SHIPPED/DELIVERED with no shipment row at all — the
    // admin and the customer were shown a courier reality that did not
    // exist. Ensure one now (never submits anything to a provider).
    if (lowerStatus === "shipped") {
      try {
        await this.ensureShipmentForShippedOrder(order);
      } catch (shipErr) {
        console.error(
          `[OrderService] Failed to ensure shipment for shipped order ${id}:`,
          shipErr
        );
      }
    }
    if (lowerStatus === "delivered" || lowerStatus === "completed") {
      try {
        const { ReferralService } = await import("@/services/referral.service");
        await ReferralService.qualifyReferral(id);

        // Earn loyalty points
        if (order.customer_id) {
          const subtotal = Number(order.subtotal || 0);
          if (subtotal >= 1000) {
            const pointsToEarn = Math.floor(subtotal / 100);
            const { LoyaltyService } = await import("@/services/loyalty.service");
            await LoyaltyService.earnPoints({
              userId: order.customer_id,
              points: pointsToEarn,
              referenceId: order.id,
              referenceType: "ORDER",
              description: `Earned from Order ${order.order_number}`
            });
          }
        }
      } catch (err) {
        console.error(`[OrderService] Failed to qualify referral or earn loyalty for order ${id}:`, err);
      }
    } else if (lowerStatus === "cancelled" || lowerStatus === "refunded" || lowerStatus === "returned") {
      try {
        // Reverse loyalty points
        if (order.customer_id) {
          const subtotal = Number(order.subtotal || 0);
          const pointsToReverse = Math.floor(subtotal / 100);
          if (pointsToReverse > 0) {
            const { LoyaltyService } = await import("@/services/loyalty.service");
            await LoyaltyService.reversePoints({
              userId: order.customer_id,
              referenceId: order.id,
              pointsToReverse,
              reason: `Order ${newStatus.toUpperCase()}`
            });
          }
        }
      } catch (err) {
        console.error(`[OrderService] Failed to reverse loyalty for order ${id}:`, err);
      }

      try {
        // Authoritative inventory release back to available stock in Neon
        const { InventoryService } = await import("@/services/inventory.service");
        const invService = new InventoryService();
        await invService.releaseOrderInventory(id);
      } catch (invErr) {
        console.error(`[OrderService] Failed to release inventory for order ${id}:`, invErr);
      }
    } else if (lowerStatus === "confirmed") {
      try {
        const { AlphaSmsService } = await import("@/lib/services/sms/alpha-sms.service");
        AlphaSmsService.triggerOrderConfirmationSmsAsync(id);
      } catch (smsErr) {
        console.error(`[OrderService] Failed to trigger SMS for order ${id}:`, smsErr);
      }
    }

    // Phase 8: email automations — invoice email to the customer when the
    // order completes, plus a staff notification email for every status
    // change. Fire-and-forget; the helpers never throw and a mail failure
    // must never fail the status update itself.
    void (async () => {
      try {
        const { sendOrderCompletionInvoiceEmail, notifyStaffOrderEvent } =
          await import("@/lib/notifications/order-notifications");
        if (lowerStatus === "delivered" || lowerStatus === "completed") {
          await sendOrderCompletionInvoiceEmail(id);
          // The completion SMS (with the invoice link) accompanies the
          // completion email — previously email was the only channel.
          try {
            const { AlphaSmsService } = await import(
              "@/lib/services/sms/alpha-sms.service"
            );
            AlphaSmsService.triggerOrderCompletionSmsAsync(id);
          } catch (smsErr) {
            console.error(
              `[OrderService] Failed to trigger completion SMS for order ${id}:`,
              smsErr
            );
          }
        }
        await notifyStaffOrderEvent({
          kind: "status_change",
          orderId: id,
          status: newStatus.toUpperCase(),
          previousStatus: order.status
            ? String(order.status).toUpperCase()
            : null,
        });
      } catch (err) {
        console.error(
          `[OrderService] Order email notifications failed for order ${id}:`,
          err
        );
      }
    })();

    return updated;
  }

  /**
   * Guarantee a live shipment row exists for an order entering SHIPPED.
   * A leftover 'created' draft (from a failed dispatch) is advanced;
   * otherwise a fresh record is built from the order's own dispatch data.
   * Cancelled shipments never count — an order whose only shipment was
   * cancelled gets a real row. No provider API is ever called here.
   */
  private async ensureShipmentForShippedOrder(order: any): Promise<void> {
    const { createAdminDbClient } = await import("@/lib/db/client");
    const db = createAdminDbClient();

    const { data: shipments } = await db
      .from("shipments")
      .select("id, status, consignment_id")
      .eq("order_id", order.id)
      .neq("status", "cancelled");

    const rows = (shipments || []) as any[];
    const hasLive = rows.some(
      (s) => s.status !== "created" || s.consignment_id
    );
    if (hasLive) return;

    const { ShipmentRepository } = await import(
      "@/repositories/shipment.repository"
    );
    const shipmentRepo = new ShipmentRepository();

    const draft = rows.find((s) => s.status === "created" && !s.consignment_id);
    if (draft) {
      await shipmentRepo.updateShipment(draft.id, {
        status: "shipped",
        shipped_at: new Date().toISOString(),
      } as any);
      return;
    }

    const addr = ((order as any).shipping_address || {}) as any;
    const recipientName =
      addr.recipient_name ||
      [addr.first_name, addr.last_name].filter(Boolean).join(" ") ||
      "Customer";
    const isCod =
      String(order.payment_method || "").toUpperCase() === "COD" &&
      order.payment_status !== "paid";

    // The mapped OMS order does not carry the order's courier/tracking
    // columns — read them from the raw row so the created shipment
    // reflects whatever dispatch data the order already has.
    let orderCourier: string | undefined;
    let orderTracking: string | undefined;
    try {
      const { prisma } = await import("@/lib/prisma");
      const raw = await prisma.order.findUnique({
        where: { id: order.id },
        select: { courier: true, trackingNumber: true },
      });
      orderCourier = raw?.courier || undefined;
      orderTracking = raw?.trackingNumber || undefined;
    } catch {
      // Non-fatal — the shipment is still created below.
    }

    const { ShippingService } = await import(
      "@/services/shipping/shipping.service"
    );
    const shippingService = new ShippingService();
    const items = await this.orderItemsRepo.getOrderItems(order.id);

    const shipment = await shippingService.createShipment({
      orderId: order.id,
      courierProviderCode: (orderCourier as any) || undefined,
      recipientName,
      recipientPhone: addr.phone || addr.recipient_phone || "",
      recipientAddress: addr.address_line_1 || addr.address || "",
      recipientCity: addr.city || undefined,
      recipientDistrict: addr.state || addr.district || undefined,
      isCOD: isCod,
      codAmount: isCod ? Number(order.total_amount || 0) : 0,
      items: (items || []).map((item: any) => ({
        orderItemId: item.id,
        sku: item.sku,
        productName: item.product_name,
        quantity: item.quantity,
        unitPrice: Number(item.unit_price || 0),
      })),
    });

    await shipmentRepo.updateShipment(shipment.id, {
      status: "shipped",
      shipped_at: new Date().toISOString(),
      ...(orderTracking ? { tracking_number: orderTracking } : {}),
    } as any);
  }

  async getOrderDetails(id: string, dbClient?: any) {
    const order = await this.orderRepo.getOrderById(id, dbClient);
    if (!order) return null;

    const items = await this.orderItemsRepo.getOrderItems(order.id, dbClient);

    // Fetch customer profile details if customer_id exists
    let customer = null;
    if (order.customer_id) {
      try {
        const db = dbClient || (await import("@/lib/db/client").then(m => m.createDbClient()));
        
        // 1. Fetch from customer_profiles (contains id, first_name, last_name, email, phone)
        const { data: cProfile } = await db
          .from("customer_profiles")
          .select("id, first_name, last_name, email, phone")
          .eq("id", order.customer_id)
          .maybeSingle();

        // 2. Fetch from profiles (fallback)
        const { data: profile } = await db
          .from("profiles")
          .select("id, first_name, last_name, phone, avatar_url")
          .eq("id", order.customer_id)
          .maybeSingle();

        // 3. Fetch tier from crm_customer_profiles
        const { data: crmProfile } = await db
          .from("crm_customer_profiles")
          .select("customer_tier")
          .eq("profile_id", order.customer_id)
          .maybeSingle();

        // 4. If email is still missing, try auth admin client
        let customerEmail = cProfile?.email || null;
        if (!customerEmail) {
          try {
            const { createAdminDbClient } = await import("@/lib/db/client");
            const adminDb = await createAdminDbClient();
            const { data: authUser } = await adminDb.auth.admin.getUserById(order.customer_id);
            if (authUser?.user?.email) {
              customerEmail = authUser.user.email;
            }
          } catch {
            // Admin auth not accessible in this context
          }
        }

        const firstName = cProfile?.first_name || profile?.first_name || null;
        const lastName = cProfile?.last_name || profile?.last_name || null;
        const fullName = [firstName, lastName].filter(Boolean).join(" ") || (customerEmail ? customerEmail.split("@")[0] : "Registered Customer");
        const phone = cProfile?.phone || profile?.phone || null;

        if (cProfile || profile || customerEmail) {
          customer = {
            id: order.customer_id,
            first_name: firstName,
            last_name: lastName,
            full_name: fullName,
            phone: phone,
            email: customerEmail,
            tier: crmProfile?.customer_tier || "Standard",
          };
        }
      } catch (err) {
        console.error("Error fetching order customer profile:", err);
      }
    }

    // Fetch shipping & billing addresses
    let shippingAddress = null;
    let billingAddress = null;
    try {
      const db = dbClient || (await import("@/lib/db/client").then(m => m.createDbClient()));
      
      // 1. Try order_addresses
      const { data: orderAddrs } = await db
        .from("order_addresses")
        .select("*")
        .eq("order_id", id);

      if (orderAddrs && orderAddrs.length > 0) {
        shippingAddress = orderAddrs.find((a: any) => a.address_type === "SHIPPING") || orderAddrs[0];
        billingAddress = orderAddrs.find((a: any) => a.address_type === "BILLING") || shippingAddress;
      }

      // 2. Fallback to addresses table
      if (!shippingAddress && order.shipping_address_id) {
        const { data: addr } = await db
          .from("addresses")
          .select("*")
          .eq("id", order.shipping_address_id)
          .maybeSingle();
        if (addr) shippingAddress = addr;
      }

      if (!billingAddress && order.billing_address_id) {
        const { data: addr } = await db
          .from("addresses")
          .select("*")
          .eq("id", order.billing_address_id)
          .maybeSingle();
        if (addr) billingAddress = addr;
      }
    } catch (err) {
      console.error("Error fetching order addresses:", err);
    }

    // 3. Fallback to the address JSON persisted on the order itself.
    // Prisma checkout orders store the shipping/billing address as JSON on
    // the order row (orders.shipping_address / billing_address); they have
    // no order_addresses / addresses rows and their shipping_address_id is
    // always null, so without this fallback every checkout order rendered
    // "No shipping address recorded" in admin and a blank address on the
    // invoice. BUG FIX: use the persisted JSON, normalized to the shape
    // the admin detail + invoice renderers expect.
    const normalizePersistedAddress = (a: any) => {
      if (!a || typeof a !== "object") return null;
      return {
        ...a,
        recipient_name:
          a.recipient_name ||
          [a.first_name, a.last_name].filter(Boolean).join(" ") ||
          null,
        zip: a.zip || a.postal_code || null,
      };
    };
    if (!shippingAddress) {
      shippingAddress = normalizePersistedAddress(
        (order as any).shipping_address
      );
    }
    if (!billingAddress) {
      billingAddress =
        normalizePersistedAddress((order as any).billing_address) ||
        shippingAddress;
    }

    // Fetch manual payment transaction if available
    let manualPayment = null;
    try {
      const db = dbClient || (await import("@/lib/db/client").then(m => m.createDbClient()));
      const { data: tx } = await db
        .from("payment_transactions")
        .select("*")
        .eq("order_id", id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      manualPayment = tx;
    } catch (err) {
      console.error("Error fetching manual payment transaction:", err);
    }

    return {
      ...order,
      items,
      customer,
      shippingAddress,
      billingAddress,
      manualPayment,
    };
  }
}
