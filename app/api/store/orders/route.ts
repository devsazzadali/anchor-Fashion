import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getServerSession } from '@/lib/auth/server';
import { AlphaSmsService } from '@/lib/services/sms/alpha-sms.service';
import { InventoryService } from '@/services/inventory.service';
import { OrderRepository } from '@/lib/repositories/order.repository';
import { prisma } from '@/lib/prisma';
import { lineVatAmount, roundMoney } from '@/lib/utils/vat';
import { resolveShippingCharge } from '@/lib/services/shipping/zone-resolution.service';
import { CodRiskService } from '@/lib/services/fraud/cod-risk.service';
import { CodOtpService } from '@/lib/services/fraud/cod-otp.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/store/orders — quick-checkout order creation (CheckoutModal).
 *
 * Phase 4 rewrite. The previous implementation:
 *  - trusted client-supplied item prices and total_amount verbatim
 *    (anyone could order a ৳4,850 product for ৳1),
 *  - inserted the order through the db layer with non-existent columns
 *    (shipping_total / order_source), which made the insert silently
 *    no-op — yet it still deducted real stock for the phantom order.
 * Prices, VAT and totals are now resolved server-side from the catalog
 * and the order is persisted through the same Prisma repository as the
 * main checkout; stock is deducted only for a persisted order.
 *
 * REG-73: COD orders go through the same fraud-shield gate as the main
 * checkout (CodRiskService + CodOtpService): when the risk policy requires
 * verification, the order is refused until the caller presents a verified
 * OTP session (otp_session_id + otp_code, or a previously verified
 * session). Previously this route created COD orders against any
 * client-supplied phone with no verification at all.
 * REG-79: quantities are capped by real availability (Σ quantity_available
 * across the variant's inventory levels — the same basis the cart uses)
 * before anything is persisted, and a stock-deduction failure fails the
 * order (rolled back) instead of being logged and forgotten.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      customer_name,
      customer_phone,
      customer_email,
      delivery_address,
      city,
      payment_method,
      items,
    } = body;

    // Validate required fields
    if (
      !customer_name ||
      !customer_phone ||
      !delivery_address ||
      !city ||
      !payment_method ||
      !items ||
      !Array.isArray(items) ||
      items.length === 0
    ) {
      return NextResponse.json({ error: 'Missing required order fields' }, { status: 400 });
    }

    // Authenticated customers are bound to their verified id; guests stay null.
    let effectiveCustomerId: string | null = null;
    try {
      const session = await getServerSession();
      if (session?.user?.id) {
        effectiveCustomerId = session.user.id;
      }
    } catch {
      effectiveCustomerId = null;
    }

    // ── Server-side item resolution: prices come from the catalog, never
    // from the request body. ──────────────────────────────────────────────
    const resolvedItems: {
      product_id: string;
      variant_id: string | null;
      product_name: string;
      variant_name: string | null;
      sku: string;
      quantity: number;
      unit_price: number;
      line_total: number;
      vat_percent: number;
      available_stock: number;
    }[] = [];

    for (const it of items) {
      const quantity = Math.max(1, Math.floor(Number(it.quantity) || 1));
      const productId =
        (typeof it.productId === 'string' && UUID_RE.test(it.productId) && it.productId) ||
        (typeof it.id === 'string' && UUID_RE.test(it.id) && it.id) ||
        null;
      const variantId =
        typeof it.variantId === 'string' && UUID_RE.test(it.variantId)
          ? it.variantId
          : null;
      const sku = typeof it.sku === 'string' ? it.sku : null;

      let variant: any = null;
      let product: any = null;

      if (variantId) {
        variant = await prisma.variant.findUnique({
          where: { id: variantId },
          include: {
            product: true,
            inventoryLevels: { select: { quantityAvailable: true } },
          },
        });
        product = variant?.product || null;
      }
      if (!variant && sku) {
        variant = await prisma.variant.findUnique({
          where: { sku },
          include: {
            product: true,
            inventoryLevels: { select: { quantityAvailable: true } },
          },
        });
        product = variant?.product || null;
      }
      if (!product && productId) {
        product = await prisma.product.findUnique({
          where: { id: productId },
          include: {
            variants: {
              where: { isActive: true },
              include: { inventoryLevels: { select: { quantityAvailable: true } } },
            },
          },
        });
        if (product) {
          // Match the requested size/color against variant attributes when
          // possible; otherwise fall back to the first active variant.
          variant =
            product.variants.find((v: any) => {
              const flat = Object.values((v.attributes || {}) as Record<string, any>)
                .join(' ')
                .toLowerCase();
              return (
                (!it.size || flat.includes(String(it.size).toLowerCase())) &&
                (!it.color || flat.includes(String(it.color).toLowerCase()))
              );
            }) ||
            product.variants[0] ||
            null;
        }
      }

      if (!product) {
        return NextResponse.json(
          { error: `Product not found for item: ${it.name || it.id || 'unknown'}` },
          { status: 400 }
        );
      }
      if (product.status && product.status !== 'ACTIVE') {
        return NextResponse.json(
          { error: `Product is not available: ${product.name}` },
          { status: 400 }
        );
      }

      const unitPrice = Number(
        variant?.salePrice ??
          variant?.priceOverride ??
          product.salePrice ??
          product.basePrice ??
          0
      );

      // REG-79: purchasable truth for a variant is Σ quantity_available
      // across its inventory levels — the same basis the cart enforces.
      // No resolved variant (or no levels) means nothing can be deducted
      // for this item, so its availability is honestly zero.
      const availableStock = variant
        ? (variant.inventoryLevels || []).reduce(
            (sum: number, lvl: any) => sum + Number(lvl.quantityAvailable || 0),
            0
          )
        : 0;

      resolvedItems.push({
        product_id: product.id,
        variant_id: variant?.id || null,
        product_name: product.name,
        variant_name: variant?.sku ? `SKU: ${variant.sku}` : null,
        sku: variant?.sku || product.sku || 'N/A',
        quantity,
        unit_price: unitPrice,
        line_total: roundMoney(unitPrice * quantity),
        vat_percent: Number(product.vatPercent ?? 0),
        available_stock: availableStock,
      });
    }

    // REG-79: enforce the availability cap BEFORE anything is persisted.
    // Demand is aggregated per variant — duplicate lines for the same
    // variant cannot smuggle extra units past the cap one line at a time.
    const demandByVariant = new Map<string, { quantity: number; available: number; label: string }>();
    for (const it of resolvedItems) {
      const key = it.variant_id || `product:${it.product_id}`;
      const entry = demandByVariant.get(key) || {
        quantity: 0,
        available: it.available_stock,
        label: it.variant_id ? `${it.product_name} (${it.sku})` : it.product_name,
      };
      entry.quantity += it.quantity;
      demandByVariant.set(key, entry);
    }
    for (const entry of demandByVariant.values()) {
      if (entry.quantity > entry.available) {
        return NextResponse.json(
          {
            error:
              entry.available <= 0
                ? `${entry.label} is out of stock`
                : `Only ${entry.available} left in stock for ${entry.label}`,
          },
          { status: 409 }
        );
      }
    }

    const subtotal = roundMoney(
      resolvedItems.reduce((sum, it) => sum + it.line_total, 0)
    );
    const vatAmount = roundMoney(
      resolvedItems.reduce(
        (sum, it) => sum + lineVatAmount(it.unit_price, it.quantity, it.vat_percent),
        0
      )
    );
    // Delivery charge comes from the admin-configured delivery zones
    // (Settings → Store → Shipping Zones). The zone whose district list
    // covers the customer's city/district sets the charge; every other
    // address falls to the default zone. (This replaces the hardcoded
    // Dhaka ৳100 / elsewhere ৳150 ternary.)
    const { zone: deliveryZone, charge: shippingFee } =
      await resolveShippingCharge({ district: city, city });
    const totalAmount = roundMoney(subtotal + vatAmount + shippingFee);

    const nameParts = (customer_name || '').trim().split(' ');
    const firstName = nameParts[0] || customer_name;
    const lastName = nameParts.slice(1).join(' ') || '';

    const shippingAddress = {
      first_name: firstName,
      last_name: lastName,
      phone: customer_phone,
      email: customer_email || null,
      address_line_1: delivery_address,
      city,
      district: city,
      country: 'Bangladesh',
      delivery_zone: deliveryZone.name,
      delivery_zone_id: deliveryZone.id,
    };

    // ── REG-73: COD fraud-shield gate — the same enforcement the main
    // checkout applies (processCheckoutAction). When the risk policy
    // requires verification, no order is created until the OTP session is
    // verified; a code is dispatched on first refusal so the client can
    // complete the flow with otp_session_id + otp_code. ──────────────────
    if (String(payment_method).toUpperCase() === 'COD') {
      const riskEvaluation = await CodRiskService.evaluateRisk({
        customerId: effectiveCustomerId,
        email: customer_email || '',
        phone: customer_phone,
        totalAmount,
        shippingAddress,
      });

      if (riskEvaluation.requiresVerification) {
        const otpSessionId =
          (typeof body.otp_session_id === 'string' && body.otp_session_id) ||
          randomUUID();
        const otpCode =
          typeof body.otp_code === 'string' ? body.otp_code.trim() : '';

        if (otpCode) {
          const verifyRes = await CodOtpService.verifyOtp(otpSessionId, otpCode);
          if (!verifyRes.success) {
            return NextResponse.json(
              {
                error: verifyRes.error || 'Invalid verification code.',
                verificationRequired: true,
                sessionId: otpSessionId,
                riskLevel: riskEvaluation.riskLevel,
                maskedTarget: CodOtpService.maskTarget(
                  customer_email || customer_phone,
                  customer_email ? 'email' : 'phone'
                ),
              },
              { status: 403 }
            );
          }
        } else if (!(await CodOtpService.isSessionVerified(otpSessionId))) {
          const otpInit = await CodOtpService.initiateVerification({
            sessionId: otpSessionId,
            email: customer_email || '',
            phone: customer_phone,
            customerName: customer_name,
            orderTotal: totalAmount,
          });
          return NextResponse.json(
            {
              error:
                otpInit.error ||
                'Verification required. A code has been sent to confirm this order.',
              verificationRequired: true,
              sessionId: otpSessionId,
              riskLevel: riskEvaluation.riskLevel,
              maskedTarget:
                otpInit.maskedTarget ||
                CodOtpService.maskTarget(
                  customer_email || customer_phone,
                  customer_email ? 'email' : 'phone'
                ),
              targetType: otpInit.targetType,
              remainingCooldownSeconds: otpInit.remainingCooldownSeconds,
              expirySeconds: otpInit.expirySeconds,
            },
            { status: 403 }
          );
        }
      }
    }

    // ── Persist through the authoritative Prisma repository ──────────────
    const order = await OrderRepository.createOrder(
      {
        user_id: effectiveCustomerId,
        guest_email: customer_email || null,
        status: 'confirmed',
        payment_status: 'UNPAID',
        payment_method,
        subtotal,
        shipping_fee: shippingFee,
        discount_amount: 0,
        vat_amount: vatAmount,
        tax_total: vatAmount,
        total_amount: totalAmount,
      } as any,
      resolvedItems.map((it) => ({
        product_id: it.product_id,
        variant_id: it.variant_id,
        product_name: it.product_name,
        variant_name: it.variant_name,
        sku: it.sku,
        quantity: it.quantity,
        unit_price: it.unit_price,
        line_total: it.line_total,
      })) as any,
      shippingAddress as any,
      shippingAddress as any
    );

    // ── Deduct stock for the persisted order ─────────────────────────────
    // REG-79: a deduction failure must FAIL the order, not be logged and
    // forgotten — the persisted order is rolled back (items cascade) and
    // the caller gets an error. (Availability was already capped above;
    // this covers failures between the cap check and the deduction.)
    try {
      const inventoryService = new InventoryService();
      await inventoryService.deductStockForOrderItems(
        order.id,
        resolvedItems.map((it) => ({
          productId: it.product_id,
          variantId: it.variant_id,
          sku: it.sku,
          quantity: it.quantity,
        }))
      );
    } catch (invErr) {
      console.error('[Store Orders API] Error deducting inventory stock:', invErr);
      await prisma.order
        .delete({ where: { id: order.id } })
        .catch((delErr) =>
          console.error('[Store Orders API] Failed to roll back order after deduction failure:', delErr)
        );
      return NextResponse.json(
        { error: 'Could not reserve stock for this order. Please try again.' },
        { status: 500 }
      );
    }

    // ── Confirmation SMS (best-effort; service degrades without a key) ───
    try {
      AlphaSmsService.triggerOrderConfirmationSmsAsync(order.id);
    } catch (smsErr) {
      console.error('[Store Orders API] SMS trigger error:', smsErr);
    }

    return NextResponse.json({
      message: 'Order created successfully',
      order: {
        ...order,
        items: resolvedItems,
        delivery_address,
        city,
        customer_name,
        customer_phone,
      },
    });
  } catch (error) {
    console.error('[Store Orders API] Unexpected error creating order:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
