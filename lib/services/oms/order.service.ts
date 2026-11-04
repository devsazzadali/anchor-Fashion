import { OrderRepository } from "@/lib/repositories/oms/order.repository";
import { OrderItemsRepository } from "@/lib/repositories/oms/order-items.repository";
import { OrderStatusService } from "./order-status.service";
import { Order, OrderStatus } from "@/types/oms";
import type { createDbClient } from "@/lib/db/client";

type DbClient = ReturnType<typeof createDbClient>;

/**
 * Address JSON persisted on the order row (orders.shipping_address /
 * billing_address) — the same shape lib/repositories/oms calls
 * OmsShippingAddressJson, plus the zip keys the normalizer below reads.
 */
interface PersistedAddressJson {
  recipient_name?: string | null;
  recipientName?: string | null;
  name?: string | null;
  first_name?: string | null;
  firstName?: string | null;
  last_name?: string | null;
  lastName?: string | null;
  address_line_1?: string | null;
  addressLine1?: string | null;
  address_line_2?: string | null;
  addressLine2?: string | null;
  street?: string | null;
  phone?: string | null;
  city?: string | null;
  district?: string | null;
  state?: string | null;
  zip?: string | null;
  postal_code?: string | null;
  country?: string | null;
  [key: string]: unknown;
}

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
    role?: string,
    // FIX ROUND 29 (D8): optional cancellation reason/note from the
    // admin dialog, forwarded to the repository's history write.
    opts?: { reason?: string; note?: string }
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

    const updated = await this.orderRepo.updateOrderStatus(id, newStatus, updatedBy, opts);

    // Check for referral qualification and loyalty points
    const lowerStatus = newStatus.toLowerCase();
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
      }

      try {
        // Authoritative inventory release back to available stock in Neon
        const { InventoryService } = await import("@/services/inventory.service");
        const invService = new InventoryService();
        await invService.releaseOrderInventory(id);
      } catch (invErr) {
      }
    } else if (lowerStatus === "confirmed") {
      try {
        const { AlphaSmsService } = await import("@/lib/services/sms/alpha-sms.service");
        AlphaSmsService.triggerOrderConfirmationSmsAsync(id);
      } catch (smsErr) {
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
      }
    })();

    return updated;
  }

  async getOrderDetails(id: string, dbClient?: DbClient | null) {
    const order = await this.orderRepo.getOrderById(id, dbClient);
    if (!order) return null;

    // billing_address rides the persisted order JSON but is not declared
    // on types/oms Order (shipping_address is, as an any) — widen once.
    const orderAddresses = order as Order & {
      billing_address?: PersistedAddressJson | null;
    };

    const items = await this.orderItemsRepo.getOrderItems(order.id, dbClient);

    // Fetch customer profile details if customer_id exists
    let customer = null;
    if (order.customer_id) {
      try {
        const db: DbClient = dbClient || (await import("@/lib/db/client").then(m => m.createDbClient()));
        
        // 1. Fetch from profiles (FIX ROUND 28, M-2: the
        // customer_profiles table does not exist — profiles is the
        // real customer table; the Prisma read below remains the
        // canonical second source.)
        const { data: cProfile } = await db
          .from("profiles")
          .select("id, first_name, last_name, email, phone")
          .eq("id", order.customer_id)
          .maybeSingle();

        // 2. Fetch from profiles (fallback) — via Prisma, not the fluent
        // builder: the builder's reads against profile-shaped tables have
        // silently dropped data before (REG-42 disease), and this row is
        // the canonical source for the customer's name/phone.
        let profile: {
          id: string;
          first_name: string | null;
          last_name: string | null;
          phone: string | null;
          avatar_url: string | null;
        } | null = null;
        try {
          const { prisma } = await import("@/lib/prisma");
          const p = await prisma.profile.findUnique({
            where: { id: order.customer_id },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true,
              avatarUrl: true,
            },
          });
          if (p) {
            profile = {
              id: p.id,
              first_name: p.firstName,
              last_name: p.lastName,
              phone: p.phone,
              avatar_url: p.avatarUrl,
            };
          }
        } catch {
          profile = null;
        }

        // 3. Customer tier.
        // FIX ROUND 28 (sweep): this read a `crm_customer_profiles`
        // table that does not exist, so the tier was always the
        // "Standard" fallback at the use site below. Tier data has no
        // real home until the crm_customers DDL (Round-28 proposal)
        // lands — the use site now states "Standard" directly.

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
        // REG-32-phone: the profile rows frequently carry NO phone (the
        // checkout-collected phone — the number the customer actually
        // verified and the business's identity key — is stored on the
        // order itself, inside the persisted shipping/billing address
        // JSON). Fall back to the order's stored phone so the manager /
        // admin Customer Details card can always show a callable number
        // when one exists anywhere on the order.
        const storedPhone =
          order.shipping_address?.phone ||
          orderAddresses.billing_address?.phone ||
          null;
        const phone = cProfile?.phone || profile?.phone || storedPhone;

        if (cProfile || profile || customerEmail) {
          customer = {
            id: order.customer_id,
            first_name: firstName,
            last_name: lastName,
            full_name: fullName,
            phone: phone,
            email: customerEmail,
            // Tier: "Standard" until the crm_customers DDL lands
            // (see the Round-28 note in step 3 above).
            tier: "Standard",
          };
        }
      } catch (err) {
      }
    }

    // Fetch shipping & billing addresses.
    // FIX ROUND 28 (M-2): the order_addresses and addresses tables do
    // not exist in this schema (and orders has no shipping_address_id /
    // billing_address_id columns) — those two reads always resolved
    // empty and are removed. The address JSON persisted on the order
    // row (step 3 below) is the real source.
    let shippingAddress = null;
    let billingAddress = null;

    // 3. Fallback to the address JSON persisted on the order itself.
    // Prisma checkout orders store the shipping/billing address as JSON on
    // the order row (orders.shipping_address / billing_address); they have
    // no order_addresses / addresses rows and their shipping_address_id is
    // always null, so without this fallback every checkout order rendered
    // "No shipping address recorded" in admin and a blank address on the
    // invoice. BUG FIX: use the persisted JSON, normalized to the shape
    // the admin detail + invoice renderers expect.
    const normalizePersistedAddress = (a: PersistedAddressJson | null | undefined) => {
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
        order.shipping_address
      );
    }
    if (!billingAddress) {
      billingAddress =
        normalizePersistedAddress(orderAddresses.billing_address) ||
        shippingAddress;
    }

    // Fetch manual payment transaction if available.
    // FIX ROUND 28 (M-2): reads the real `payments` ledger (the phantom
    // payment_transactions table meant this was always null) and maps
    // the row to the legacy transaction shape the admin detail renders.
    let manualPayment = null;
    try {
      const db: DbClient = dbClient || (await import("@/lib/db/client").then(m => m.createDbClient()));
      const { data: tx } = await db
        .from("payments")
        .select("*")
        .eq("order_id", id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (tx) {
        const { paymentRowToLegacyTransaction } = await import(
          "@/lib/payments/order-payment-record"
        );
        manualPayment = paymentRowToLegacyTransaction(tx);
      }
    } catch (err) {
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
