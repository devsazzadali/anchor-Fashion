import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/server';
import { AlphaSmsService } from '@/lib/services/sms/alpha-sms.service';
import { InventoryService } from '@/services/inventory.service';
import { OrderRepository } from '@/lib/repositories/order.repository';
import { prisma } from '@/lib/prisma';
import { lineVatAmount, roundMoney } from '@/lib/utils/vat';
import { resolveShippingCharge } from '@/lib/services/shipping/zone-resolution.service';

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
          include: { product: true },
        });
        product = variant?.product || null;
      }
      if (!variant && sku) {
        variant = await prisma.variant.findUnique({
          where: { sku },
          include: { product: true },
        });
        product = variant?.product || null;
      }
      if (!product && productId) {
        product = await prisma.product.findUnique({
          where: { id: productId },
          include: { variants: { where: { isActive: true } } },
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
      });
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
