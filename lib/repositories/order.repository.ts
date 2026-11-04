import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { Order, OrderAddress, OrderItem, OrderStatus } from "@/types/checkout.types";
import { recordOrderPayment } from "@/lib/payments/order-payment-record";

type OrderRowForMapping = Prisma.OrderGetPayload<{
  include: { items: true; statusHistory: true };
}>;

// createOrder callers pass these extra fields alongside Partial<Order> /
// Partial<OrderAddress> (guest identity + POS aliases + camelCase address
// fallbacks); the intersections tell the truth about what is read below.
type OrderCreateInput = Partial<Order> & {
  customer_id?: string | null;
  guest_email?: string | null;
  email?: string | null;
};

type OrderCreateAddressInput = Partial<OrderAddress> & {
  firstName?: string | null;
  lastName?: string | null;
  phone_number?: string | null;
};

function mapPrismaOrderToCheckoutOrder(record: OrderRowForMapping): Order {
  const shippingAddr = record.shippingAddress as Record<string, any> | null;
  const billingAddr = record.billingAddress as Record<string, any> | null;

  return {
    id: record.id,
    user_id: record.profileId || record.customerId,
    order_number: record.orderNumber,
    // A3-A5: the public view-only invoice token must travel with the
    // mapped order — the OMS confirmation email links to /invoice/<token>
    // and previously never received it, so it fell back to a login-gated
    // account page.
    invoice_token: record.invoiceToken || null,
    status: (record.status || "confirmed") as OrderStatus,
    subtotal: Number(record.subtotal || 0),
    shipping_fee: Number(record.shippingFee || 0),
    discount_amount: Number(record.discount || 0),
    vat_amount: Number(record.vatAmount || 0),
    tax_total: Number(record.vatAmount || 0),
    total_amount: Number(record.totalAmount || 0),
    grand_total: Number(record.totalAmount || 0),
    shipping_total: Number(record.shippingFee || 0),
    discount_total: Number(record.discount || 0),
    currency: "BDT",
    payment_method: record.paymentMethod || "COD",
    payment_status: record.paymentStatus || "UNPAID",
    reservation_expires_at: record.reservationExpiresAt ? new Date(record.reservationExpiresAt).toISOString() : null,
    paid_at: record.paidAt ? new Date(record.paidAt).toISOString() : null,
    cancelled_at: record.cancelledAt ? new Date(record.cancelledAt).toISOString() : null,
    notes: record.notes,
    risk_level: "LOW",
    created_at: record.createdAt ? new Date(record.createdAt).toISOString() : new Date().toISOString(),
    updated_at: record.updatedAt ? new Date(record.updatedAt).toISOString() : new Date().toISOString(),
    items: (record.items || []).map((item) => ({
      id: item.id,
      order_id: item.orderId,
      // OrderItem declares product_id non-null; the column is nullable and
      // the value passes through unchanged (narrowing assertion only).
      product_id: item.productId as string,
      variant_id: item.variantId,
      sku: item.sku,
      product_name: item.productName,
      variant_name: item.variantName,
      quantity: item.quantity,
      unit_price: Number(item.unitPrice || 0),
      line_total: Number(item.totalPrice || 0),
      total_price: Number(item.totalPrice || 0),
      created_at: item.createdAt ? new Date(item.createdAt).toISOString() : new Date().toISOString(),
    })),
    shipping_address: shippingAddr ? (shippingAddr as OrderAddress) : undefined,
    billing_address: billingAddr ? (billingAddr as OrderAddress) : undefined,
  };
}

export class OrderRepository {
  /**
   * Create an order with items and addresses authoritative in Neon PostgreSQL via Prisma.
   */
  static async createOrder(
    orderData: OrderCreateInput,
    items: Partial<OrderItem>[],
    shippingAddress: OrderCreateAddressInput,
    billingAddress?: OrderCreateAddressInput
  ): Promise<Order> {
    const customerId = orderData.user_id ?? orderData.customer_id ?? null;
    const customerNote = orderData.notes;
    const orderNumber = orderData.order_number || `AF-${Date.now()}`;
    const statusNote = customerNote
      ? `Order placed. Customer Note: ${customerNote.trim()}`
      : "Order placed successfully";

    // 0. Resolve valid profileId in Neon PostgreSQL to satisfy orders_profile_id_fkey
    let validProfileId: string | null = null;
    const candidateEmail =
      shippingAddress?.email ||
      orderData?.guest_email ||
      orderData?.email ||
      null;

    if (customerId) {
      try {
        const existingProfile = await prisma.profile.findUnique({
          where: { id: customerId },
          select: { id: true },
        });

        if (existingProfile) {
          validProfileId = existingProfile.id;
        } else if (candidateEmail) {
          const profileByEmail = await prisma.profile.findUnique({
            where: { email: candidateEmail },
            select: { id: true },
          });

          if (profileByEmail) {
            validProfileId = profileByEmail.id;
          } else {
            // Auto-create customer profile in Neon
            const newProfile = await prisma.profile.create({
              data: {
                id: customerId,
                email: candidateEmail,
                firstName:
                  shippingAddress?.first_name ||
                  shippingAddress?.firstName ||
                  null,
                lastName:
                  shippingAddress?.last_name ||
                  shippingAddress?.lastName ||
                  null,
                phone: shippingAddress?.phone || null,
              },
              select: { id: true },
            });
            validProfileId = newProfile.id;
          }
        }
      } catch (profileErr) {
        validProfileId = null;
      }
    } else if (candidateEmail) {
      try {
        const profileByEmail = await prisma.profile.findUnique({
          where: { email: candidateEmail },
          select: { id: true },
        });
        if (profileByEmail) {
          validProfileId = profileByEmail.id;
        }
      } catch {
        validProfileId = null;
      }
    }

    // 0.05 Phase 12 (hybrid checkout): a GUEST order belongs to a customer
    // profile keyed by the verified checkout phone number — find-or-create
    // it silently (no registration wall, no auth credentials) and link the
    // order. When the order was linked by email instead, enrich that profile
    // with the checkout phone so the phone identity stays complete. A
    // profile problem must never block the order itself.
    if (!customerId) {
      try {
        const ship: OrderCreateAddressInput = shippingAddress || {};
        const identity = {
          phone: ship.phone || ship.phone_number || null,
          email: candidateEmail,
          firstName: ship.first_name || ship.firstName || null,
          lastName: ship.last_name || ship.lastName || null,
          phoneVerified:
            orderData.verification_status === "VERIFIED",
        };
        const { findOrCreateGuestProfile, enrichProfileFromCheckout } =
          await import("@/lib/services/customer/guest-profile.service");
        if (validProfileId) {
          await enrichProfileFromCheckout(validProfileId, identity);
        } else {
          const autoProfile = await findOrCreateGuestProfile(identity);
          if (autoProfile) validProfileId = autoProfile.id;
        }
      } catch (profileErr) {
      }
    }

    // 0.1 Validate foreign key IDs for Products and Variants in Neon
    const productIds = items.map((i) => i.product_id).filter(Boolean) as string[];
    const variantIds = items.map((i) => i.variant_id).filter(Boolean) as string[];

    const [existingProducts, existingVariants] = await Promise.all([
      productIds.length > 0
        ? prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true },
          })
        : [],
      variantIds.length > 0
        ? prisma.variant.findMany({
            where: { id: { in: variantIds } },
            select: { id: true },
          })
        : [],
    ]);

    const validProductIds = new Set(existingProducts.map((p) => p.id));
    const validVariantIds = new Set(existingVariants.map((v) => v.id));

    // 1. Authoritative Create in Neon PostgreSQL via Prisma
    const createdPrismaOrder = await prisma.order.create({
      data: {
        orderNumber,
        profileId: validProfileId,
        status: (orderData.status || "confirmed").toUpperCase(),
        paymentStatus: orderData.payment_status
          ? orderData.payment_status.toUpperCase()
          : "UNPAID",
        paymentMethod: orderData.payment_method || "COD",
        subtotal: orderData.subtotal ?? 0,
        discount: orderData.discount_amount ?? orderData.discount_total ?? 0,
        // VAT: checkout passes vat_amount; POS passes tax_total (same meaning).
        vatAmount:
          orderData.vat_amount ?? orderData.tax_total ?? 0,
        shippingFee: orderData.shipping_fee ?? orderData.shipping_total ?? 0,
        // POS passes grand_total instead of total_amount — accept both so POS
        // orders no longer persist a 0 total.
        totalAmount:
          orderData.total_amount ?? orderData.grand_total ?? 0,
        reservationExpiresAt: orderData.reservation_expires_at
          ? new Date(orderData.reservation_expires_at)
          : null,
        couponCode: orderData.coupon_code || undefined,
        // Phase 8: persist the COD fraud-risk evaluation. placeOrder has
        // always computed these fields, but createOrder silently dropped
        // them (the orders table had no columns until Phase 8's DDL).
        riskLevel: orderData.risk_level || undefined,
        riskScore:
          typeof orderData.risk_score === "number"
            ? orderData.risk_score
            : undefined,
        riskReasons: orderData.risk_reasons || undefined,
        verificationStatus: orderData.verification_status || undefined,
        verificationVerifiedAt: orderData.verification_verified_at
          ? new Date(orderData.verification_verified_at)
          : undefined,
        notes: customerNote || null,
        shippingAddress: shippingAddress as Prisma.InputJsonValue,
        billingAddress: billingAddress ? (billingAddress as Prisma.InputJsonValue) : undefined,
        items: {
          create: items.map((item) => ({
            productId: item.product_id && validProductIds.has(item.product_id) ? item.product_id : null,
            variantId: item.variant_id && validVariantIds.has(item.variant_id) ? item.variant_id : null,
            productName: item.product_name || "Product",
            variantName: item.variant_name || null,
            sku: item.sku || "N/A",
            quantity: Number(item.quantity) || 1,
            unitPrice: Number(item.unit_price) || 0,
            totalPrice: Number(item.line_total || item.total_price || 0),
          })),
        },
        statusHistory: {
          create: {
            status: (orderData.status || "confirmed").toUpperCase(),
            notes: statusNote,
            changedBy: validProfileId,
          },
        },
      },
      include: {
        items: true,
        statusHistory: true,
      },
    });

    // S6-7: record the payment ledger row for this placement (the
    // storefront checkout path — see lib/payments/order-payment-record).
    try {
      await recordOrderPayment({
        orderId: createdPrismaOrder.id,
        amount: Number(createdPrismaOrder.totalAmount) || 0,
        method: createdPrismaOrder.paymentMethod,
        paymentStatus: createdPrismaOrder.paymentStatus,
      });
    } catch (payErr) {
    }

    return mapPrismaOrderToCheckoutOrder(createdPrismaOrder);
  }

  /**
   * Get an order by ID
   */
  static async getOrderById(orderId: string): Promise<Order | null> {
    const prismaRecord = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, statusHistory: true },
    });

    if (prismaRecord) {
      return mapPrismaOrderToCheckoutOrder(prismaRecord);
    }
    return null;
  }

  /**
   * Get an order by Order Number
   */
  static async getOrderByNumber(orderNumber: string): Promise<Order | null> {
    const prismaRecord = await prisma.order.findUnique({
      where: { orderNumber },
      include: { items: true, statusHistory: true },
    });

    if (prismaRecord) {
      return mapPrismaOrderToCheckoutOrder(prismaRecord);
    }
    return null;
  }

  /**
   * Get all orders by User/Customer ID
   */
  static async getOrdersByUserId(userId: string): Promise<Order[]> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);
    const records = await prisma.order.findMany({
      where: {
        OR: [
          ...(isUuid ? [{ profileId: userId }, { customerId: userId }] : [{ customerId: userId }]),
        ],
      },
      include: { items: true, statusHistory: true },
      orderBy: { createdAt: "desc" },
    });
    return records.map(mapPrismaOrderToCheckoutOrder);
  }

  /**
   * Update order status authoritative in Neon PostgreSQL
   */
  static async updateOrderStatus(
    id: string,
    status: string,
    notes?: string,
    changedBy?: string
  ): Promise<void> {
    const upper = status.toUpperCase();
    await prisma.order.update({
      where: { id },
      data: {
        status: upper,
        updatedAt: new Date(),
        statusHistory: {
          create: {
            status: upper,
            notes: notes || `Order status updated to ${upper}`,
            changedBy: changedBy || null,
          },
        },
      },
    });

    if (upper === "CANCELLED" || upper === "REFUNDED" || upper === "RETURNED") {
      try {
        const { InventoryService } = await import("@/services/inventory.service");
        const invService = new InventoryService();
        await invService.releaseOrderInventory(id);
      } catch (invErr) {
      }
    }
  }

  // Instance method compatibility
  async getOrderById(id: string): Promise<Order | null> {
    return OrderRepository.getOrderById(id);
  }
  async getOrderByNumber(orderNumber: string): Promise<Order | null> {
    return OrderRepository.getOrderByNumber(orderNumber);
  }
  async getOrdersByUserId(userId: string): Promise<Order[]> {
    return OrderRepository.getOrdersByUserId(userId);
  }
  async createOrder(
    orderData: OrderCreateInput,
    items: Partial<OrderItem>[],
    shippingAddress: OrderCreateAddressInput,
    billingAddress?: OrderCreateAddressInput
  ): Promise<Order> {
    return OrderRepository.createOrder(orderData, items, shippingAddress, billingAddress);
  }
  async updateOrderStatus(id: string, status: string, notes?: string): Promise<void> {
    return OrderRepository.updateOrderStatus(id, status, notes);
  }
}
