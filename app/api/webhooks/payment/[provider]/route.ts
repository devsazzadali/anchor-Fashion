import { NextRequest, NextResponse } from "next/server";
import { paymentWebhookService } from "@/services/payment-webhook.service";
import { WebhookService } from "@/services/webhooks/webhook.service";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider: providerCode } = await params;

  try {
    const rawBody = await req.text();

    // ── Webhook authenticity (fail CLOSED) ──────────────────────────
    // Same gate as the generic /api/webhooks/payment route (Round 28
    // m-6). This provider-path route previously forwarded ANY
    // unauthenticated POST into PaymentWebhookService.processWebhook,
    // which can flip order status and release stock based on the
    // provider result — the authenticity check lived only in the
    // sibling route and was missed here (found R30+). The caller must
    // present a valid HMAC-SHA256 signature of the raw body, keyed by
    // the configured <PROVIDER>_WEBHOOK_SECRET, in the
    // `x-provider-signature` (or `stripe-signature`) header. Unset
    // secret or bad signature → reject BEFORE any payload is parsed
    // or processed. Dedicated gateway endpoints (SSLCommerz IPN /
    // callbacks under /api/payment/* and /api/webhooks/sslcommerz/*)
    // verify with the gateway directly and are unaffected.
    const secret =
      process.env[`${providerCode.toUpperCase()}_WEBHOOK_SECRET`];
    if (!secret) {
      return NextResponse.json(
        { success: false, error: "Webhook not configured" },
        { status: 503 }
      );
    }
    const signature =
      req.headers.get("x-provider-signature") ||
      req.headers.get("stripe-signature") ||
      "";
    if (!WebhookService.verifySignature(rawBody, signature, secret)) {
      return NextResponse.json(
        { success: false, error: "Invalid signature" },
        { status: 401 }
      );
    }

    let payload = {};

    // Try parse as JSON
    try {
      payload = JSON.parse(rawBody);
    } catch {
      // If not JSON, try to parse form data
      const urlParams = new URLSearchParams(rawBody);
      payload = Object.fromEntries(urlParams.entries());
    }

    const headers = Object.fromEntries(req.headers.entries());

    const result = await paymentWebhookService.processWebhook(
      providerCode,
      payload,
      headers
    );

    return NextResponse.json({ success: true, result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 400 }
    );
  }
}
