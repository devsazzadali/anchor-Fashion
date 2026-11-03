import { NextResponse } from "next/server";
import { CourierGatewayService } from "@/services/courier/courier-gateway.service";
import { ShippingService } from "@/services/shipping/shipping.service";
import { CourierProviderCode } from "@/types/shipping.types";
import {
  getPresentedWebhookSecret,
  sharedSecretMatches,
} from "@/lib/webhooks/shared-secret";

/**
 * POST /api/webhooks/courier/[provider]
 * Provider-specific webhook endpoint for courier status updates.
 * Each provider has its own URL so they can be configured separately.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const providerCode = provider as CourierProviderCode;

  // ── Webhook authenticity (REG-76: fail CLOSED) ─────────────────────
  // This route previously forwarded ANY unauthenticated POST into
  // shipment/order status mutation: the gateway providers ignore the
  // signature argument, so anyone who knew a shipment's tracking code
  // could forge a "Delivered"/"Cancelled" update. Mirror the dedicated
  // /api/webhooks/pathao route (REG-70): the caller must present the
  // configured <PROVIDER>_WEBHOOK_SECRET (header `x-webhook-secret` or
  // `?token=`), and the call is rejected before any parsing or mutation
  // when the secret is unset or wrong.
  const webhookSecret =
    process.env[`${provider.toUpperCase()}_WEBHOOK_SECRET`];
  if (!webhookSecret) {
    return NextResponse.json(
      { success: false, message: "Webhook not configured" },
      { status: 401 }
    );
  }
  if (!sharedSecretMatches(getPresentedWebhookSecret(req), webhookSecret)) {
    return NextResponse.json(
      { success: false, message: "Invalid webhook secret" },
      { status: 401 }
    );
  }

  try {
    const rawBody = await req.text();
    const signature =
      req.headers.get("x-signature") ||
      req.headers.get("x-hmac-signature") ||
      req.headers.get("x-provider-signature") ||
      "";

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON payload" },
        { status: 400 }
      );
    }

    // Normalize event via provider-specific processing
    const result = await CourierGatewayService.processWebhook(
      providerCode,
      payload,
      signature
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error?.message },
        { status: 400 }
      );
    }

    if (result.data) {
      // Update shipment in the database
      const shippingService = new ShippingService();
      await shippingService.processWebhookEvent(result.data, providerCode);
    }

    return NextResponse.json({ received: true, provider: providerCode });
  } catch (err) {
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
