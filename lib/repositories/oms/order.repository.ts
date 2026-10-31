import { prisma } from "@/lib/prisma";
import { Order, OrderStatus } from "@/types/oms";
import { escapeLikeWildcards } from "@/lib/utils/like-escape";
import { parseVariantAttributes } from "@/lib/utils/variant-attributes";
import {
  recordOrderPayment,
  ensureOrderPaymentSuccess,
} from "@/lib/payments/order-payment-record";

export class OrderRepository {
  async getOrderById(id: string, _?: any): Promise<Order | null> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    let order;

    if (isUuid) {
      order = await prisma.order.findUnique({
        where: { id },
        include: {
          items: { include: { variant: { select: { attributes: true } } } },
          statusHistory: true,
        },
      });
    } else {
      order = await prisma.order.findUnique({
        where: { orderNumber: id },
        include: {
          items: { include: { variant: { select: { attributes: true } } } },
          statusHistory: true,
        },
      });
    }

    if (!order) return null;
    const mapped = mapPrismaOrderToOms(order);

    // REG-17: surface the order's shipment on the detail payload. The
    // shipment row is born on the SHIPPED transition (S5-8) but nothing
    // ever read it back for the admin detail — the page showed no
    // shipment reference even though the record existed. Attach the
    // latest shipment (snake_case, the shape the detail page renders).
    try {
      const shipment = await prisma.shipment.findFirst({
        where: { orderId: order.id },
        orderBy: { createdAt: "desc" },
      });
      if (shipment) {
        (mapped as any).shipment = {
          id: shipment.id,
          shipment_number: shipment.shipmentNumber,
          status: shipment.status,
          tracking_number: shipment.trackingNumber,
          courier_provider_code: shipment.courierProviderCode,
          courier: shipment.courier,
          recipient_name: shipment.recipientName,
          recipient_city: shipment.recipientCity,
          is_cod: shipment.isCod ?? false,
          cod_amount:
            shipment.codAmount != null ? Number(shipment.codAmount) : null,
          created_at: shipment.createdAt?.toISOString() ?? null,
          shipped_at: shipment.shippedAt?.toISOString() ?? null,
          delivered_at: shipment.deliveredAt?.toISOString() ?? null,
        };
      }
    } catch (shipErr) {
      console.error(
        `[OrderRepository] Failed to attach shipment for order ${order.id}:`,
        shipErr
      );
    }
    return mapped;
  }

  async getOrderByNumber(orderNumber: string, _?: any): Promise<Order | null> {
    const order = await prisma.order.findUnique({
      where: { orderNumber },
      include: {
        items: { include: { variant: { select: { attributes: true } } } },
        statusHistory: true,
      },
    });
    if (!order) return null;
    return mapPrismaOrderToOms(order);
  }

  async getOrders(options?: {
    customerId?: string;
    status?: OrderStatus | string;
    paymentMethod?: string;
    paymentStatus?: string;
    search?: string;
    page?: number;
    limit?: number;
  }, _?: any) {
    const page = Math.max(1, options?.page || 1);
    const limit = Math.min(100, Math.max(1, options?.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (options?.customerId) {
      const isCustUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(options.customerId);
      if (isCustUuid) {
        where.OR = [
          { profileId: options.customerId },
          { customerId: options.customerId },
        ];
      }
    }
    
    if (options?.status && options.status !== "all") {
      const s = String(options.status).toLowerCase().trim();
      if (s === "pending") {
        where.status = { in: ["PENDING_PAYMENT", "PAID", "DRAFT"] };
      } else if (s === "processing") {
        where.status = { in: ["CONFIRMED", "PREPARING", "PICKING", "PACKING", "READY_FOR_SHIPMENT", "SHIPPED"] };
      } else if (s === "completed") {
        where.status = { in: ["COMPLETED", "DELIVERED"] };
      } else if (s === "cancelled") {
        where.status = { in: ["CANCELLED", "REFUNDED", "RETURNED", "FAILED"] };
      } else {
        where.status = s.toUpperCase();
      }
    }

    if (options?.paymentMethod && options.paymentMethod !== "all") {
      where.paymentMethod = options.paymentMethod;
    }

    if (options?.paymentStatus && options.paymentStatus !== "all") {
      where.paymentStatus = options.paymentStatus;
    }

    if (options?.search) {
      // REG-43: escape LIKE wildcards in the staff-typed term (both the
      // orderNumber contains and the JSON string_contains compile to
      // Postgres LIKE patterns).
      const searchTerm = escapeLikeWildcards(options.search);
      where.OR = [
        { orderNumber: { contains: searchTerm, mode: "insensitive" } },
        {
          shippingAddress: {
            path: ["firstName"],
            string_contains: searchTerm,
          }
        },
        {
          shippingAddress: {
            path: ["phone"],
            string_contains: searchTerm,
          }
        }
      ];
    }

    const [orders, count] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: { items: true },
      }),
      prisma.order.count({ where }),
    ]);

    const enrichedOrders = orders.map((o: any) => {
      const mapped = mapPrismaOrderToOms(o);
      const shippingAddr = mapped.shipping_address as any;
      let customerName = "Guest Customer";
      
      if (shippingAddr?.first_name || shippingAddr?.last_name || shippingAddr?.firstName) {
        customerName = `${shippingAddr.firstName || shippingAddr.first_name || ""} ${shippingAddr.lastName || shippingAddr.last_name || ""}`.trim();
      }

      return {
        ...mapped,
        customer_name: customerName,
        customer_phone: shippingAddr?.phone || null,
        customer_city: shippingAddr?.city || null,
        items_count: o.items.reduce((sum: number, i: any) => sum + (Number(i.quantity) || 1), 0),
        items_preview: o.items.map((i: any) => i.productName).filter(Boolean).slice(0, 3).join(", "),
      } as Order;
    });

    return {
      data: enrichedOrders,
      count,
    };
  }

  async getOrderMetrics(_?: any) {
    // REG-84 (Round 19): was fetch-all + JS aggregation over every
    // order row. Per-status counts and revenue sums are now computed
    // by the database (one groupBy) and bucketed here under the exact
    // status lists the loop used. Equivalence against the old
    // implementation was proven byte-identical over the full
    // production dataset (35 orders; Round-19 equivalence harness).
    const groups = await prisma.order.groupBy({
      by: ["status"],
      _count: { _all: true },
      _sum: { totalAmount: true },
    });

    let totalOrders = 0;
    let totalRevenue = 0;
    let pendingOrders = 0;
    let processingOrders = 0;
    let completedOrders = 0;
    let cancelledOrders = 0;

    for (const g of groups) {
      const count = g._count._all;
      totalOrders += count;
      const s = String(g.status).toLowerCase();

      if (s !== "cancelled" && s !== "failed") {
        totalRevenue += Number(g._sum.totalAmount || 0);
      }

      if (["pending", "pending_payment", "draft"].includes(s)) {
        pendingOrders += count;
      } else if (["confirmed", "preparing", "processing", "picking", "packing", "ready_for_shipment", "shipped"].includes(s)) {
        processingOrders += count;
      } else if (["completed", "delivered"].includes(s)) {
        completedOrders += count;
      } else if (["cancelled", "refunded", "returned", "failed"].includes(s)) {
        cancelledOrders += count;
      }
    }

    return {
      totalOrders,
      totalRevenue,
      pendingOrders,
      processingOrders,
      completedOrders,
      cancelledOrders,
    };
  }

  async createOrder(
    orderData: any
  ): Promise<Order> {
    const isProfileUuid =
      orderData.user_id &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        orderData.user_id
      );

    const created = await prisma.order.create({
      data: {
        orderNumber: orderData.order_number,
        profileId: isProfileUuid ? orderData.user_id : undefined,
        customerId: orderData.customer_id || undefined,
        status: (orderData.status || "CONFIRMED").toUpperCase(),
        subtotal: orderData.subtotal || 0,
        shippingFee: orderData.shipping_fee || orderData.shipping_total || 0,
        discount: orderData.discount_amount || orderData.discount_total || 0,
        // VAT: OMS callers pass tax_total, checkout passes vat_amount. This
        // mapping was missing, so POS/OMS orders persisted vat_amount = 0
        // even though their totals included VAT.
        vatAmount: orderData.vat_amount ?? orderData.tax_total ?? 0,
        totalAmount: orderData.total_amount || orderData.grand_total || 0,
        paymentMethod: orderData.payment_method || "COD",
        paymentStatus: orderData.payment_status || "UNPAID",
        shippingAddress: (orderData.shipping_address as any) || {},
        billingAddress: (orderData.billing_address as any) || undefined,
        notes: orderData.notes,
        statusHistory: {
          create: {
            status: (orderData.status || "CONFIRMED").toUpperCase(),
            notes: "Order created via OMS",
          },
        },
      },
      include: { items: true, statusHistory: true },
    });

    // S6-7: record the order's payment row (Finance → Transactions was
    // permanently empty — nothing ever wrote the payments table).
    // Never let the ledger write fail the placement itself.
    try {
      await recordOrderPayment({
        orderId: created.id,
        amount: Number(created.totalAmount) || 0,
        method: created.paymentMethod,
        paymentStatus: created.paymentStatus,
      });
    } catch (payErr) {
      console.error("[OrderRepository.createOrder] Payment record failed:", payErr);
    }

    return mapPrismaOrderToOms(created);
  }

  async updateOrderStatus(
    id: string,
    status: OrderStatus,
    updatedBy?: string,
    _?: any
  ): Promise<Order> {
    const isUserUuid =
      updatedBy &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        updatedBy
      );

    const target = status.toUpperCase();

    // S3-5: lifecycle fields were never stamped — orders advanced through
    // the OMS kept shipped_at / delivered_at NULL and COD orders stayed
    // UNPAID after delivery. Stamp them on the transitions that mean them:
    //   SHIPPED              → shippedAt = now
    //   DELIVERED / COMPLETED → deliveredAt = now; a COD order is paid in
    //                          cash on delivery, so paymentStatus → PAID
    //                          (+ paidAt) for COD only — prepaid flows
    //                          already carry their own payment state.
    const current = await prisma.order.findUnique({
      where: { id },
      select: {
        paymentMethod: true,
        paymentStatus: true,
        totalAmount: true,
        shippingFee: true,
        shippingAddress: true,
      },
    });
    const now = new Date();
    const lifecycle: {
      shippedAt?: Date;
      deliveredAt?: Date;
      paymentStatus?: string;
      paidAt?: Date;
    } = {};
    if (target === "SHIPPED") {
      lifecycle.shippedAt = now;
    }
    if (target === "DELIVERED" || target === "COMPLETED") {
      lifecycle.deliveredAt = now;
      if (
        String(current?.paymentMethod || "").toUpperCase() === "COD" &&
        String(current?.paymentStatus || "").toUpperCase() !== "PAID"
      ) {
        lifecycle.paymentStatus = "PAID";
        lifecycle.paidAt = now;
      }
    }

    const updated = await prisma.order.update({
      where: { id },
      data: {
        status: target,
        ...lifecycle,
        statusHistory: {
          create: {
            status: target,
            notes: updatedBy
              ? `Order status updated to ${status} (by ${updatedBy})`
              : `Order status updated to ${status}`,
            changedBy: isUserUuid ? updatedBy : null,
          }
        }
      },
      include: { items: true, statusHistory: true },
    });

    // S5-8: shipping an order never created a shipment record — the
    // shipments table sat at 0 rows while orders went SHIPPED/DELIVERED,
    // leaving Shipment Management permanently empty and the lifecycle
    // disconnected from the shipping module. Birth the shipment here,
    // at the single status write point: exactly one per order, created
    // on the SHIPPED transition, carrying the recipient snapshot and
    // COD amount from the order, in the "created" state (born, awaiting
    // courier assignment — no courier is implied yet).
    if (target === "SHIPPED") {
      try {
        const existing = await prisma.shipment.findFirst({
          where: { orderId: id },
          select: { id: true },
        });
        if (!existing) {
          const addr = (current?.shippingAddress ?? {}) as Record<string, any>;
          const recipientName =
            addr.recipient_name ||
            addr.recipientName ||
            addr.name ||
            [addr.first_name || addr.firstName, addr.last_name || addr.lastName]
              .filter(Boolean)
              .join(" ")
              .trim() ||
            null;
          const recipientAddress =
            [addr.address_line_1 || addr.addressLine1 || addr.street, addr.address_line_2 || addr.addressLine2]
              .filter(Boolean)
              .join(", ") || null;
          const isCod =
            String(current?.paymentMethod || "").toUpperCase() === "COD";
          await prisma.shipment.create({
            data: {
              orderId: id,
              shipmentNumber: `SHP-${Date.now()}`,
              status: "created",
              courier: null,
              recipientName,
              recipientPhone: addr.phone || null,
              recipientAddress,
              recipientCity: addr.city || null,
              recipientDistrict: addr.district || addr.state || null,
              isCod,
              codAmount: isCod ? Number(current?.totalAmount ?? 0) : 0,
              shippingCharge: Number(current?.shippingFee ?? 0),
              shippedAt: now,
              createdBy: isUserUuid ? updatedBy! : null,
            },
          });
        }
      } catch (shipErr) {
        // The status transition itself has already committed; a shipment
        // failure must not fail the order update, but it must be loud —
        // silent auxiliary failures are how S5-8 went unnoticed.
        console.error(
          `[OrderRepository] Failed to create shipment for shipped order ${id}:`,
          shipErr
        );
      }
    }

    // REG-53: the shipment born on SHIPPED was never advanced again —
    // orders reached DELIVERED while their shipment sat at "created"
    // forever (live: both SHP rows for DELIVERED orders 2FOZ/JEH0,
    // delivered_at NULL, zero tracking events). Close the shipment at
    // the same single status write point: on DELIVERED / COMPLETED move
    // it to the shipping module's terminal "delivered" state, stamp
    // delivered_at, and append a timeline event — written via Prisma
    // with the events table's REAL columns (shipment_id, status,
    // timestamp, notes); the older fluent-builder writers pass phantom
    // columns (status_description, event_time, …) that the real table
    // does not have, which is why the timeline has always been empty.
    // CANCELLED closes a non-terminal shipment the same way.
    if (target === "DELIVERED" || target === "COMPLETED" || target === "CANCELLED") {
      try {
        const shipment = await prisma.shipment.findFirst({
          where: { orderId: id },
          select: { id: true, status: true },
        });
        if (shipment) {
          const terminalStates = ["delivered", "cancelled", "returned_to_origin"];
          const currentShipmentStatus = String(shipment.status || "").toLowerCase();
          if (!terminalStates.includes(currentShipmentStatus)) {
            if (target === "CANCELLED") {
              await prisma.shipment.update({
                where: { id: shipment.id },
                data: { status: "cancelled" },
              });
              await prisma.shipment_tracking_events.create({
                data: {
                  shipment_id: shipment.id,
                  status: "cancelled",
                  timestamp: now,
                  notes: "Order cancelled — shipment closed.",
                },
              });
            } else {
              await prisma.shipment.update({
                where: { id: shipment.id },
                data: { status: "delivered", deliveredAt: now },
              });
              await prisma.shipment_tracking_events.create({
                data: {
                  shipment_id: shipment.id,
                  status: "delivered",
                  timestamp: now,
                  notes: "Order delivered — shipment closed.",
                },
              });
            }
          }
        }
      } catch (shipSyncErr) {
        // Same rule as the SHIPPED block: the order transition has
        // committed; a shipment-sync failure must be loud, not fatal.
        console.error(
          `[OrderRepository] Failed to sync shipment for order ${id} on ${target}:`,
          shipSyncErr
        );
      }
    }

    // S6-7 + REG-18: when this transition marked the order PAID (the
    // round-5 COD hook above), ENSURE its payment ledger row exists and
    // is SUCCESS so Finance → Transactions reflects the cash actually
    // collected. Flipping alone was not enough: orders placed before
    // the round-8 placement writer existed have no row to flip and
    // reached PAID with an empty ledger (AF-20261029-2FOZ).
    if (lifecycle.paymentStatus === "PAID") {
      try {
        await ensureOrderPaymentSuccess({
          orderId: id,
          amount: Number(current?.totalAmount ?? 0),
          method: current?.paymentMethod,
        });
      } catch (payErr) {
        console.error(
          `[OrderRepository] Failed to ensure payment SUCCESS for order ${id}:`,
          payErr
        );
      }
    }

    return mapPrismaOrderToOms(updated);
  }

  async getOrdersForFulfillment(): Promise<Order[]> {
    const validStatuses = ["PAID", "PREPARING", "PICKING", "PACKING", "READY_FOR_SHIPMENT"];
    
    const orders = await prisma.order.findMany({
      where: { status: { in: validStatuses } },
      include: { items: true },
      orderBy: { createdAt: "asc" },
    });

    return orders.map(mapPrismaOrderToOms);
  }
}

function mapPrismaOrderToOms(record: any): Order {
  const shippingAddr = record.shippingAddress as Record<string, any> | null;
  const billingAddr = record.billingAddress as Record<string, any> | null;

  return {
    id: record.id,
    customer_id: record.customerId || record.profileId || null,
    user_id: record.profileId,
    order_number: record.orderNumber,
    status: (record.status || "confirmed").toLowerCase() as OrderStatus,
    subtotal: Number(record.subtotal || 0),
    tax_total: Number(record.vatAmount || 0),
    vat_amount: Number(record.vatAmount || 0),
    shipping_total: Number(record.shippingFee || 0),
    discount_total: Number(record.discount || 0),
    grand_total: Number(record.totalAmount || 0),
    currency: "BDT",
    shipping_address_id: null,
    billing_address_id: null,
    payment_intent_id: null,
    shipping_fee: Number(record.shippingFee || 0),
    discount_amount: Number(record.discount || 0),
    total_amount: Number(record.totalAmount || 0),
    payment_method: record.paymentMethod || "COD",
    payment_status: record.paymentStatus || "UNPAID",
    notes: record.notes,
    // Phase 8: real persisted fraud-risk evaluation (was hard-coded "LOW"
    // for every order). Falls back to LOW only when no evaluation exists
    // (e.g. legacy orders created before risk persistence).
    risk_level: (record.riskLevel || "LOW") as any,
    risk_score: record.riskScore ?? null,
    risk_reasons: (record.riskReasons as any) ?? null,
    verification_status: record.verificationStatus ?? null,
    verification_verified_at:
      record.verificationVerifiedAt?.toISOString?.() ?? null,
    created_at: record.createdAt?.toISOString(),
    updated_at: record.updatedAt?.toISOString(),
    placed_at: record.createdAt?.toISOString() || null,
    paid_at: record.paidAt?.toISOString() || null,
    shipped_at: record.shippedAt?.toISOString() || null,
    delivered_at: record.deliveredAt?.toISOString() || null,
    cancelled_at: record.cancelledAt?.toISOString() || null,
    updated_by: null,
    items: (record.items || []).map((item: any) => {
      // S5-1: readable size/colour from the variant's attribute JSON
      // when the query included it; nulls otherwise.
      const attrs = parseVariantAttributes(item.variant?.attributes);
      return {
        id: item.id,
        order_id: item.orderId,
        product_id: item.productId,
        variant_id: item.variantId,
        sku: item.sku,
        product_name: item.productName,
        variant_name: item.variantName,
        variant_size: attrs.size,
        variant_color: attrs.color,
        variant_label: attrs.label,
        quantity: item.quantity,
        unit_price: Number(item.unitPrice || 0),
        line_total: Number(item.totalPrice || 0),
        total_price: Number(item.totalPrice || 0),
        created_at: item.createdAt?.toISOString(),
      };
    }),
    shipping_address: shippingAddr ? (shippingAddr as any) : undefined,
    billing_address: billingAddr ? (billingAddr as any) : undefined,
  } as Order;
}
