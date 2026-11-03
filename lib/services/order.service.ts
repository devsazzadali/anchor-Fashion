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
import { FALLBACK_DELIVERY_FEES } from "@/lib/constants/shipping";
import { applyFreeShippingThreshold } from "@/lib/services/shipping/zone-resolution.service";

export class OrderService {
  /**
   * Calculate Order Summary
   */
  /**
   * Fallback shipping fees by method slug — used ONLY when the
   * admin-configured delivery zones cannot be loaded. Keys must match
   * the RadioGroup values in checkout-form.tsx. REG-63: values come
   * from the ONE canonical fallback pair (lib/constants/shipping).
   */
  private static readonly SHIPPING_FEES: Record<string, number> = {
    home_delivery: FALLBACK_DELIVERY_FEES.insideDhaka,
    home_delivery_outside: FALLBACK_DELIVERY_FEES.outsideDhaka,
  };

  /**
   * Zone-backed fee for a checkout method: "home_delivery" resolves the
   * zone covering Dhaka; "home_delivery_outside" resolves the default
   * zone. Returns null when no zones are configured (caller falls back).
   */
  private static async zoneFeeForMethod(
    shippingMethod?: string
  ): Promise<number | null> {
    try {
      const { listActiveZones, pickZone } = await import(
        "@/lib/services/shipping/zone-resolution.service"
      );
      const zones = await listActiveZones();
      if (!zones.length) return null;
      const zone =
        shippingMethod === "home_delivery_outside"
          ? zones.find((z) => z.is_default) || zones[0]
          : pickZone(zones, "Dhaka", "Dhaka");
      return zone ? zone.rate : null;
    } catch {
      return null;
    }
  }

  /**
   * Zone for a concrete delivery ADDRESS (Workstream C correction): the
   * delivery charge follows the district/city on the address — the zone
   * whose district list covers it, else the default zone. This is the
   * primary resolution; the shipping METHOD is only a fallback hint for
   * address-less summary calls. Returns null when no zones exist.
   */
  static async zoneForAddress(
    address?: { city?: string | null; state?: string | null; district?: string | null } | null
  ): Promise<{ id: string; name: string; code: string | null; rate: number } | null> {
    try {
      const { listActiveZones, pickZone } = await import(
        "@/lib/services/shipping/zone-resolution.service"
      );
      const zones = await listActiveZones();
      if (!zones.length) return null;
      const zone = pickZone(
        zones,
        address?.district || address?.state,
        address?.city
      );
      return zone
        ? { id: zone.id, name: zone.name, code: zone.code, rate: zone.rate }
        : null;
    } catch {
      return null;
    }
  }

  /**
   * Resolve the coupon applied to the checkout session (if any) and its
   * discount for the given subtotal. The order-summary sidebar lets the
   * customer apply a coupon to the session, but until Phase 4 the server
   * never read it back: the sidebar displayed a discounted total while the
   * order was charged in full. Soft variant returns null on any problem
   * (used for display summaries); placeOrder re-validates strictly.
   */
  /**
   * A3-A8: the coupon identity for a checkout. Signed-in customers use
   * their user id; GUESTS are bound by their verified checkout phone —
   * the same identity key the auto-profile system uses (normalized
   * phone → profile). Without this, guests had no id at all, the
   * per-user limit check was skipped, and "1 per customer" coupons
   * were reusable without limit through guest checkout.
   */
  private static async resolveCouponCustomerId(
    userId: string | null | undefined,
    phone?: string | null
  ): Promise<string | undefined> {
    if (userId) return userId;
    if (!phone) return undefined;
    try {
      const { normalizePhone, findProfileByNormalizedPhone } = await import(
        "@/lib/services/customer/guest-profile.service"
      );
      const normalized = normalizePhone(phone);
      if (!normalized) return undefined;
      const profile = await findProfileByNormalizedPhone(normalized);
      return profile?.id || undefined;
    } catch {
      return undefined;
    }
  }

  private static async resolveSessionCoupon(
    cartId: string,
    userId: string | null | undefined,
    subtotal: number,
    sessionId?: string | null,
    guestPhone?: string | null
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
        await this.resolveCouponCustomerId(userId, guestPhone)
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
    sessionId?: string | null,
    shippingAddress?: { city?: string | null; state?: string | null; district?: string | null } | null
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

    // Derive the shipping fee from the admin-configured delivery zones:
    // FIRST by the delivery address (district/city → zone), then by the
    // selected method; the historical flat schedule is only a last
    // fallback when zones cannot be loaded at all.
    const addressZone =
      subtotal > 0 ? await this.zoneForAddress(shippingAddress) : null;
    const zoneFee =
      subtotal > 0 && !addressZone
        ? await this.zoneFeeForMethod(shippingMethod)
        : null;
    const zone_shipping_fee =
      subtotal > 0
        ? addressZone?.rate ??
          zoneFee ??
          (this.SHIPPING_FEES[shippingMethod ?? "home_delivery"] ?? FALLBACK_DELIVERY_FEES.insideDhaka)
        : 0;

    // Free-shipping threshold (Settings → Store Info, advertised in the
    // announcement bar and the cart's progress meter): when the merchandise
    // subtotal reaches the configured threshold, delivery is free. The
    // delivery zone is still resolved and recorded on the order by
    // placeOrder — only the fee is waived.
    // FIX ROUND 28 (M-7): the application now goes through the ONE
    // shared helper (applyFreeShippingThreshold in
    // lib/services/shipping/zone-resolution.service) that the guest
    // /api/store/orders path also uses, so all three order-math paths
    // (cart summary, session placeOrder via this summary, guest) apply
    // the identical rule. The threshold value itself remains
    // single-sourced in getFreeShippingThreshold (REG-81).
    const shipping_fee = await applyFreeShippingThreshold(
      subtotal,
      zone_shipping_fee
    );

    // Coupon applied to the checkout session (see resolveSessionCoupon).
    const coupon = await this.resolveSessionCoupon(
      cartId,
      userId,
      subtotal,
      sessionId,
      (shippingAddress as any)?.phone || null
    );
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
      sessionId,
      checkoutData.information.shipping_address
    );

    // Strict coupon validation before anything is persisted: a coupon the
    // customer applied that has since expired / hit its limit must fail the
    // order with the coupon error, not silently change the charged total.
    // A3-A8: the previous catch re-threw only errors whose message matched
    // a regex — every other validation failure (e.g. "not active yet") was
    // swallowed into appliedCoupon = null while summary.discount_amount
    // (which HAD resolved the coupon) was still charged: discount granted,
    // consumeCoupon never called, used_count never incremented. Now ANY
    // invalid session coupon fails the order; only a session-lookup
    // problem (no code readable) leaves the order coupon-free.
    // A3-A8: guests validate against their phone-bound auto-profile id.
    const couponCustomerId = await this.resolveCouponCustomerId(
      userId,
      checkoutData.information.shipping_address.phone
    );
    let appliedCoupon: { code: string; discount: number } | null = null;
    let sessionCouponCode: string | null = null;
    try {
      const sessionRow = await prisma.checkoutSession.findUnique({
        where: { id: sessionId },
        select: { couponCode: true },
      });
      sessionCouponCode = sessionRow?.couponCode?.trim() || null;
    } catch {
      sessionCouponCode = null;
    }
    if (sessionCouponCode) {
      const validation = await CouponService.validateAndCalculateDiscount(
        sessionCouponCode,
        summary.subtotal,
        couponCustomerId
      );
      if (!validation.isValid) {
        throw new Error(validation.error || "Invalid coupon");
      }
      appliedCoupon = {
        code: validation.coupon?.code || sessionCouponCode,
        discount: validation.discount,
      };
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
    // Stamp the resolved delivery zone onto the persisted address so the
    // order record (and invoice) shows which zone set the charge.
    const resolvedZone = await this.zoneForAddress(rawShippingAddress as any);
    const withZone = resolvedZone
      ? {
          ...(rawShippingAddress as any),
          delivery_zone: resolvedZone.name,
          delivery_zone_id: resolvedZone.id,
        }
      : rawShippingAddress;
    const shippingAddress =
      guestEmail && !(withZone as any)?.email
        ? { ...(withZone as any), email: guestEmail }
        : withZone;
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
    } catch (reserveErr) {
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
        // A3-A8/B3: record the redemption against the SAME identity the
        // per-user limit was validated with — for guests that is the
        // phone-bound auto-profile (createOrder has just linked the
        // order to it, so order.user_id carries it), never null. The
        // consume writes the coupon_usages row + used_count increment
        // as one operation; a recording failure cancels the order
        // (below), so a granted discount can no longer go unrecorded.
        await CouponService.consumeCoupon(
          appliedCoupon.code,
          userId || (order as any).user_id || couponCustomerId,
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
