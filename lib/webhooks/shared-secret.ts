import crypto from "crypto";

/**
 * Shared-secret authentication for courier webhooks (Steadfast, Pathao).
 *
 * Both providers' dashboards can be configured with a webhook URL that
 * either carries a `?token=<secret>` query parameter or sends an
 * `x-webhook-secret` header. The configured secret lives in an env var
 * (STEADFAST_WEBHOOK_SECRET / PATHAO_WEBHOOK_SECRET). Verification is
 * fail-closed: routes reject the call when the env secret is unset, so
 * an unconfigured deployment never processes unauthenticated status
 * updates. See REG-70 / REG-76.
 */

/** Extracts the caller-presented secret from the header or query string. */
export function getPresentedWebhookSecret(req: Request): string | null {
  return (
    req.headers.get("x-webhook-secret") ||
    new URL(req.url).searchParams.get("token")
  );
}

/** Constant-time comparison of the presented secret against the configured one. */
export function sharedSecretMatches(
  presented: string | null,
  configuredSecret: string
): boolean {
  const presentedBuf = Buffer.from(presented || "");
  const secretBuf = Buffer.from(configuredSecret);
  return (
    presentedBuf.length === secretBuf.length &&
    crypto.timingSafeEqual(presentedBuf, secretBuf)
  );
}

/**
 * Validates a courier consignment / tracking identifier before it is
 * used in a database lookup. Real identifiers from both providers are
 * alphanumeric with dashes/underscores (e.g. "DEMO-TRK-001", "DM101918",
 * numeric Pathao ids). Anything else — in particular the PostgREST
 * filter metacharacters (commas, parentheses, dots) — is rejected so a
 * payload value can never alter a query's meaning.
 */
const CONSIGNMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function isValidConsignmentId(value: unknown): value is string {
  return typeof value === "string" && CONSIGNMENT_ID_PATTERN.test(value);
}
