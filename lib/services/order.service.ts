import { OrderRepository } from "../repositories/order.repository";
import { CheckoutRepository } from "../repositories/checkout.repository";
import { CartService } from "./cart.service";
import { CheckoutFormValues } from "@/schemas/checkout.schema";
import { Order, OrderItem, PaymentPayload, OrderStatus, RiskLevel } from "@/types/checkout.types";
import { InventoryService, ReservationItem } from "@/services/inventory.service";
import { WarehouseService } from "@/services/warehouse.service";
import { CouponService } from "@/services/coupon.service";
import { prisma } from "@/lib/prisma";
import { totalVatAmount } from "@/lib/utils/vat";

export class OrderService {
  /**
   * Calculate Order Summary
   */
  /**
   * Shipping fee lookup by method slug.
   * Keys must match the RadioGroup values in checkout-form.tsx.
   */
  private static readonly SHIPPING_FEES: Record<string, number> = {
    home_delivery: 100,          // Inside Dhaka
    home_delivery_outside: 150,  // Outside Dhaka
  };

  /**
   * Resolve the coupon applied to the checkout session (if any) and its
   * discount for the given subtotal. The order-summary sidebar lets the
   * customer apply a coupon to the session, but until Phase 4 the server
   * never read it back: the sidebar displayed a discounted total while the
   * order was charged in full. Soft variant returns null on any problem
   * (used for display summaries); placeOrder re-validates strictly.
   */
  private static async resolveSessionCoupon(
    cartId: string,
    userId: string | null | undefined,
    subtotal: number,
    sessionId?: string | null
  ): Promise<{ code: string; discount: number } | null> {
    try {
      const session = sessionId
        ? await prisma.checkoutSession.findUnique({
            where: { id: sessionId },
            select: { couponCode: true },
          })
        : await prisma.checkoutSession.findFirst({
            where: { cartId },
            orderBy: { updatedAt: "desc" },
            select: { couponCode: true },
          });
      const code = session?.couponCode?.trim();
      if (!code) return null;

      const validation = await CouponService.validateAndCalculateDiscount(
        code,
        subtotal,
        userId || undefined
      );
      if (!validation.isValid) return null;
      return { code: validation.coupon?.code || code, discount: validation.discount };
    } catch {
      return null;
    }
  }

  static async calculateSummary(
    cartId: string,
    userId?: string | null,
    shippingMethod?: string,
    sessionId?: string | null
  ): Promise<{
    subtotal: number;
    shipping_fee: number;
    discount_amount: number;
    vat_amount: number;
    total_amount: number;
  }> {
    const cart = await CartService.getOrCreateCart(userId, null, cartId);

    if (!cart || !cart.items) {
      return {
        subtotal: 0,
        shipping_fee: 0,
        discount_amount: 0,
        vat_amount: 0,
        total_amount: 0,
      };
    }

    const resolvePrice = (item: any) =>
      item.variant?.sale_price ||
      item.variant?.price ||
      item.product?.sale_price ||
      item.product?.price ||
      0;

    const subtotal = cart.items.reduce((sum, item) => {
      return sum + resolvePrice(item) * item.quantity;
    }, 0);

    // VAT is charged per product (product.vat_percent) ON TOP of the selling
    // price — see lib/utils/vat.ts. This replaces the old behaviour where the
    // checkout UI displayed a hardcoded 15% "estimated tax" the server never
    // actually charged.
    const vat_amount = totalVatAmount(
      (cart.items as any[]).map((item) => ({
        unitPrice: resolvePrice(item),
        quantity: item.quantity,
        vatPercent: item.product?.vat_percent ?? 0,
      }))
    );

    // Derive shipping fee from selected method; default to inside-Dhaka rate.
    const shipping_fee =
      subtotal > 0
        ? (this.SHIPPING_FEES[shippingMethod ?? "home_delivery"] ?? 100)
        : 0;

    // Coupon applied to the checkout session (see resolveSessionCoupon).
    const coupon = await this.resolveSessionCoupon(cartId, userId, subtotal, sessionId);
    const discount_amount = coupon?.discount ?? 0;

    const total_amount = Math.max(
      0,
      subtotal + shipping_fee - discount_amount + vat_amount
    );

    return { subtotal, shipping_fee, discount_amount, vat_amount, total_amount };
  }

  /**
   * Place Order from Checkout Session
   */
  static async placeOrder(
    cartId: string,
    userId: string | null,
    guestEmail: string | null,
    checkoutData: CheckoutFormValues,
    sessionId: string,
    riskMetadata?: {
      risk_level?: RiskLevel;
      risk_score?: number;
      risk_reasons?: string[];
      verification_status?: string;
      verification_verified_at?: string | null;
    }
  ): Promise<Order> {
    const cart = await CartService.getOrCreateCart(userId, null, cartId);
    if (!cart || !cart.items || cart.items.length === 0) {
      throw new Error("Cart is empty or not found");
    }

    const summary = await this.calculateSummary(
      cartId,
      userId,
      checkoutData.shipping.shipping_method,
      sessionId
    );

    // Strict coupon validation before anything is persisted: a coupon the
    // customer applied that has since expired / hit its limit must fail the
    // order with the coupon error, not silently change the charged total.
    let appliedCoupon: { code: string; discount: number } | null = null;
    try {
      const sessionRow = await prisma.checkoutSession.findUnique({
        where: { id: sessionId },
        select: { couponCode: true },
      });
      const code = sessionRow?.couponCode?.trim();
      if (code) {
        const validation = await CouponService.validateAndCalculateDiscount(
          code,
          summary.subtotal,
          userId || undefined
        );
        if (!validation.isValid) {
          throw new Error(validation.error || "Invalid coupon");
        }
        appliedCoupon = {
          code: validation.coupon?.code || code,
          discount: validation.discount,
        };
      }
    } catch (err) {
      if (err instanceof Error && /coupon|Minimum order|expired|usage limit|already used/i.test(err.message)) {
        throw err;
      }
      // Session lookup problems must not block a coupon-free checkout; the
      // soft summary above already resolved any discount consistently.
      appliedCoupon = null;
    }

    // Generate Order Number
    const dateStr = new Date().toISOString().split("T")[0].replace(/-/g, "");
    const randomStr = Math.random().toString(36).substring(2, 6).toUpperCase();
    const orderNumber = `AF-${dateStr}-${randomStr}`;

    const reservationExpiresAt =
      checkoutData.payment.payment_method === "COD"
        ? null
        : new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const orderData: Partial<Order> = {
      user_id: userId,
      // Store the checkout session ID so it can be cleaned up after payment.
      session_id: sessionId,
      order_number: orderNumber,
      // Use lowercase statuses to match the DB enum and dashboard queries.
      status: (checkoutData.payment.payment_method === "COD"
        ? "confirmed"
        : "pending_payment") as OrderStatus,
      subtotal: summary.subtotal,
      shipping_fee: summary.shipping_fee,
      discount_amount: summary.discount_amount,
      coupon_code: appliedCoupon?.code || null,
      vat_amount: summary.vat_amount,
      tax_total: summary.vat_amount,
      total_amount: summary.total_amount,
      currency: "BDT",
      payment_method: checkoutData.payment.payment_method,
      reservation_expires_at: reservationExpiresAt,
      notes: checkoutData.notes,
      risk_level: (riskMetadata?.risk_level || "LOW") as any,
      risk_score: riskMetadata?.risk_score ?? 0,
      risk_reasons: riskMetadata?.risk_reasons || [],
      verification_status:
        riskMetadata?.verification_status ||
        (checkoutData.payment.payment_method === "COD" ? "EXEMPT" : "UNVERIFIED"),
      verification_verified_at: riskMetadata?.verification_verified_at || null,
    };

    const orderItems: Partial<OrderItem>[] = (cart.items as any[]).map((item: any) => {
      const price =
        item.variant?.sale_price ||
        item.variant?.price ||
        item.product?.sale_price ||
        item.product?.price ||
        0;
      return {
        product_id: item.product_id,
        variant_id: item.variant_id,
        quantity: item.quantity,
        unit_price: price,
        line_total: price * item.quantity,
        product_name: item.product?.title || "Unknown Product",
        variant_name: item.variant?.sku ? `SKU: ${item.variant.sku}` : null,
        sku: item.variant?.sku || "N/A",
      } as any;
    });

    // Phase 8: persist the checkout email onto the order's shipping
    // address. Guests type their email at checkout, but it previously
    // lived only on the checkout session — once the order was placed the
    // address was lost, so guests could not be emailed their invoice and
    // the repository's email→profile linking never matched.
    const rawShippingAddress = checkoutData.information.shipping_address;
    const shippingAddress =
      guestEmail && !(rawShippingAddress as any)?.email
        ? { ...rawShippingAddress, email: guestEmail }
        : rawShippingAddress;
    const billingAddress = checkoutData.payment.billing_address_same_as_shipping
      ? shippingAddress
      : checkoutData.payment.billing_address!;

    // Create the order via repository
    const order = await OrderRepository.createOrder(
      orderData,
      orderItems,
      shippingAddress,
      billingAddress
    );

    // Atomically reserve inventory via Prompt 2 reserveOrderInventory for all finalized orders (COD and digital)
    try {
      const warehouseService = new WarehouseService();
      const defaultWarehouse = await warehouseService
        .getDefaultWarehouse()
        .catch(() => null);
      const fallbackWarehouseId =
        defaultWarehouse?.id || "85bf6ad1-be55-47b2-ab31-07b05c43bcfc";

      const reservationItems: ReservationItem[] = [];
      for (const item of (cart.items as any[])) {
        const variantId = (item.variant_id || item.product_id) as string;
        if (!variantId) continue;

        let itemWarehouseId = fallbackWarehouseId;
        try {
          const level = await prisma.inventoryLevel.findFirst({
            where: {
              variantId: variantId,
              quantityAvailable: { gte: item.quantity },
            },
            orderBy: { quantityAvailable: "desc" },
          });

          if (level?.warehouseId) {
            itemWarehouseId = level.warehouseId;
          } else {
            const anyLevel = await prisma.inventoryLevel.findFirst({
              where: { variantId: variantId },
              orderBy: { quantityAvailable: "desc" },
            });

            if (anyLevel?.warehouseId) {
              itemWarehouseId = anyLevel.warehouseId;
            }
          }
        } catch (_) {}

        reservationItems.push({
          variant_id: variantId,
          warehouse_id: itemWarehouseId,
          quantity: item.quantity,
        });
      }

      if (reservationItems.length > 0) {
        const inventoryService = new InventoryService();
        await inventoryService.reserveOrderInventory(order.id, reservationItems);
      }
    } catch (reserveErr: any) {
      // If reservation failed (e.g. out of stock), cancel order immediately to keep DB consistent
      try {
        await OrderRepository.updateOrderStatus(
          order.id,
          "cancelled",
          "Reservation failed: out of stock"
        );
      } catch (_) {}
      throw reserveErr;
    }

    // Consume the applied coupon (increments used_count + writes the usage
    // row). On failure, roll the whole order back: release the reservation
    // (idempotent) and cancel, mirroring the reservation-failure path.
    if (appliedCoupon) {
      try {
        await CouponService.consumeCoupon(
          appliedCoupon.code,
          userId || undefined,
          order.id,
          appliedCoupon.discount
        );
      } catch (couponErr) {
        try {
          const inventoryService = new InventoryService();
          await inventoryService.releaseOrderInventory(order.id);
        } catch (_) {}
        try {
          await OrderRepository.updateOrderStatus(
            order.id,
            "cancelled",
            "Coupon consumption failed"
          );
        } catch (_) {}
        throw couponErr;
      }
    }

    // For COD orders, payment is confirmed at delivery — clear the cart immediately.
    // For digital payment methods (SSLCommerz, bKash, etc.) we leave the cart
    // intact until a payment webhook confirms the transaction, so customers can
    // retry if they abandon the payment gateway.
    if (checkoutData.payment.payment_method === "COD") {
      await CartService.clearCart(cart.id);
      await CheckoutRepository.deleteSession(sessionId);
    }

    return order;
  }

  /**
   * Prepare Payment Payload
   */
  static generatePaymentPayload(
    order: Order,
    customerName: string,
    customerEmail: string,
    customerPhone: string
  ): PaymentPayload {
    return {
      order_id: order.id,
      order_number: order.order_number,
      amount: order.total_amount,
      currency: "BDT",
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone,
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/payment/success`,
      fail_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/payment/fail`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/payment/cancel`,
    };
  }
}
