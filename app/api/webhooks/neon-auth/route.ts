import { NextResponse } from "next/server";
import crypto from "crypto";
import { AlphaSmsService } from "@/lib/services/sms/alpha-sms.service";

/**
 * Neon Auth webhook receiver (Workstream F — phone-OTP login).
 *
 * The hosted Neon Auth project has Phone Authentication enabled but no
 * built-in SMS sender: when a customer requests a login OTP, Neon calls
 * this endpoint with a `send.otp` event instead (`WEBHOOK_NOT_CONFIGURED`
 * is what /phone-number/send-otp returns until a webhook URL is
 * registered in the Neon Console → Webhooks tab). We deliver the code
 * through the existing Alpha SMS service, which applies SMS_TEST_MODE
 * and writes the usual communication_logs audit row.
 *
 * ⚠️ CONTRACT NOTE: the exact hosted-Neon webhook payload shape is not
 * present in this repo's types (the @neondatabase/auth adapter only
 * types the /phone-number/send-otp endpoint itself), so the extractor
 * below follows the Better Auth phone-plugin convention and tolerates
 * the plausible field spellings (event|type; data.phoneNumber|
 * phone_number|phone; data.code|otp|token). In SMS_TEST_MODE the payload
 * SHAPE (keys only — never the code itself) is recorded so the real
 * contract can be confirmed from the first live call without persisting
 * OTP codes (same rule as the claim/COD OTP services).
 *
 * Signature: Neon Auth webhooks use the Standard Webhooks scheme
 * (webhook-id / webhook-timestamp / webhook-signature, HMAC-SHA256 over
 * `${id}.${timestamp}.${body}` with the endpoint's whsec_ secret).
 * Verification is enforced when NEON_AUTH_WEBHOOK_SECRET is set (do this
 * at registration time). Without it the receiver accepts + logs ONLY in
 * local/dev; in production it fails closed with 401 (S3-1) — an unsigned
 * send.otp must never reach the SMS provider from a production deploy.
 */

const OTP_EVENTS = new Set(["send.otp", "send_otp", "otp.send", "phone.otp"]);

function verifyStandardWebhook(
  rawBody: string,
  headers: Headers,
  secret: string
): boolean {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatureHeader = headers.get("webhook-signature");
  if (!id || !timestamp || !signatureHeader) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  // 5-minute tolerance, per the Standard Webhooks spec.
  if (Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const key = Buffer.from(
    secret.startsWith("whsec_") ? secret.slice(6) : secret,
    "base64"
  );
  const expected = crypto
    .createHmac("sha256", key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");

  // Header format: "v1,<base64sig>" possibly space-separated multiples.
  return signatureHeader.split(" ").some((part) => {
    const sig = part.includes(",") ? part.split(",")[1] : part;
    if (!sig) return false;
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

function pickString(...values: any[]): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

export async function POST(req: Request) {
  const rawBody = await req.text();

  const secret = process.env.NEON_AUTH_WEBHOOK_SECRET;
  if (!secret) {
    // S3-1 (security): fail CLOSED in production. While the secret is unset
    // this receiver cannot distinguish a genuine Neon Auth event from a
    // forged one, and a forged send.otp reaches the SMS provider with an
    // attacker-chosen phone number and message — an open SMS relay the
    // moment the SMS account is funded. Local/dev keeps the accept + log
    // posture so the payload contract can still be observed there.
    const isProduction =
      process.env.NODE_ENV === "production" ||
      process.env.NEXT_PUBLIC_ENVIRONMENT === "production";
    if (isProduction) {
      console.error(
        "[NeonAuth Webhook] REJECTED: NEON_AUTH_WEBHOOK_SECRET is not set in production — refusing to process an unverifiable webhook call. Register the webhook + secret in the Neon Console to enable phone-OTP delivery."
      );
      return NextResponse.json(
        { error: "Webhook not configured" },
        { status: 401 }
      );
    }
  }
  if (secret) {
    if (!verifyStandardWebhook(rawBody, req.headers, secret)) {
      console.warn("[NeonAuth Webhook] Signature verification failed");
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 401 }
      );
    }
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = pickString(payload?.type, payload?.event, payload?.name);
  const data = payload?.data ?? payload ?? {};

  if (process.env.SMS_TEST_MODE === "true") {
    // Shape-only audit: keys, never values (the payload carries the OTP).
    console.log(
      "[NeonAuth Webhook] event:",
      eventType,
      "| payload keys:",
      Object.keys(payload || {}),
      "| data keys:",
      Object.keys(data || {})
    );
  }

  if (!eventType || !OTP_EVENTS.has(eventType)) {
    // Acknowledge other lifecycle events so Neon does not retry them.
    return NextResponse.json({ received: true, ignored: eventType });
  }

  const phone = pickString(
    data.phoneNumber,
    data.phone_number,
    data.phone,
    payload?.phoneNumber
  );
  const code = pickString(
    data.code,
    data.otp,
    data.otpCode,
    data.otp_code,
    data.token
  );

  if (!phone || !code) {
    console.warn(
      "[NeonAuth Webhook] send.otp payload missing phone/code. data keys:",
      Object.keys(data || {})
    );
    return NextResponse.json(
      { error: "Payload missing phoneNumber or code" },
      { status: 400 }
    );
  }

  const result = await AlphaSmsService.sendSMS({
    to: phone,
    message: `Your Anchor Fashion login code is ${code}. It expires in 5 minutes. Do not share it with anyone.`,
    type: "OTP",
  });

  if (!result.success) {
    console.error(
      "[NeonAuth Webhook] SMS dispatch failed:",
      result.error || result.status
    );
    // Non-2xx so Neon retries delivery of the webhook.
    return NextResponse.json(
      { error: "SMS dispatch failed" },
      { status: 502 }
    );
  }

  return NextResponse.json({ success: true });
}
