import { createAdminDbClient } from "@/lib/db/client";
import { decryptCredentialsObject } from "@/utils/encryption.util";

/**
 * Resolve the configured webhook secret for a courier provider.
 *
 * Resolution order:
 *  1. The `<PROVIDER>_WEBHOOK_SECRET` env var (deployment-level override).
 *  2. The provider's encrypted DB credentials — `webhookSecret` inside
 *     `courier_providers.config.credentials`, settable from the admin
 *     dashboard (Operations → Logistics → Couriers → Configure Settings),
 *     so an admin can activate courier webhooks without Vercel access.
 *
 * Returns null when neither is set; callers must fail closed (REG-76).
 */
export async function resolveCourierWebhookSecret(
  provider: string,
): Promise<string | null> {
  const envSecret = process.env[`${provider.toUpperCase()}_WEBHOOK_SECRET`];
  if (envSecret) return envSecret;
  try {
    const db = createAdminDbClient();
    const { data, error } = await db
      .from("courier_providers")
      .select("config")
      .eq("code", provider.toLowerCase())
      .maybeSingle();
    if (error || !data) return null;
    const creds = decryptCredentialsObject(
      ((data.config ?? {}).credentials ?? {}) as Record<string, any>,
    );
    const secret = creds.webhookSecret;
    return typeof secret === "string" && secret.trim() !== "" ? secret : null;
  } catch {
    return null;
  }
}
