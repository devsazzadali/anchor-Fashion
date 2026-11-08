import { createAdminDbClient } from "@/lib/db/client";

/**
 * External fraud check BY PHONE (BDCourier), run at order placement.
 *
 * Settings-driven via the `fraud_check_settings` row:
 *   { provider: "bdcourier", enabled: false, api_key: "",
 *     success_ratio_warn_below: 50, timeout_ms: 8000 }
 *
 * The API key is the store's OWN BDCourier key, supplied by the owner in
 * settings — there is deliberately no shared key and no env fallback.
 * While the key is empty or the check is disabled, the service records
 * an honest "not_configured" / "skipped" status on the order and never
 * fabricates a result, never blocks checkout, and never throws.
 *
 * Documented BDCourier contract: POST https://api.bdcourier.com/courier-check
 * with `Authorization: Bearer <key>` and body { "phone": "..." }, returning
 * { status, phone, success_ratio, risk_level, risk_verdict,
 *   data: { <courier>: { name, total_parcel, success_parcel, ... } } }.
 * Parsing is defensive: any figure that cannot be read stays null.
 */

export interface FraudCheckSettings {
  provider: string;
  enabled: boolean;
  api_key: string;
  success_ratio_warn_below: number;
  timeout_ms: number;
}

export const DEFAULT_FRAUD_CHECK_SETTINGS: FraudCheckSettings = {
  provider: "bdcourier",
  enabled: false,
  api_key: "",
  success_ratio_warn_below: 50,
  timeout_ms: 8000,
};

export type ExternalFraudStatus =
  | "ok"
  | "not_configured"
  | "unavailable"
  | "skipped";

export interface ExternalFraudResult {
  status: ExternalFraudStatus;
  provider: string;
  phone: string;
  successRatio: number | null;
  riskLevel: string | null;
  riskVerdict: string | null;
  totalParcels: number | null;
  deliveredParcels: number | null;
  /** Short technical detail for skipped / not_configured / unavailable. */
  reason: string | null;
  checkedAt: string;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export class ExternalFraudService {
  static async getSettings(): Promise<FraudCheckSettings> {
    try {
      const db = createAdminDbClient();
      const { data, error } = await db
        .from("settings")
        .select("value")
        .eq("key", "fraud_check_settings")
        .maybeSingle();

      if (!error && data?.value && typeof data.value === "object") {
        return { ...DEFAULT_FRAUD_CHECK_SETTINGS, ...(data.value as any) };
      }
    } catch {
      // Fall through to defaults (disabled, unconfigured).
    }
    return DEFAULT_FRAUD_CHECK_SETTINGS;
  }

  static async checkByPhone(phone: string): Promise<ExternalFraudResult> {
    const settings = await this.getSettings();
    const base: ExternalFraudResult = {
      status: "unavailable",
      provider: settings.provider || "bdcourier",
      phone,
      successRatio: null,
      riskLevel: null,
      riskVerdict: null,
      totalParcels: null,
      deliveredParcels: null,
      reason: null,
      checkedAt: new Date().toISOString(),
    };

    if (!settings.enabled) {
      return {
        ...base,
        status: "skipped",
        reason: "External fraud check is disabled in fraud settings.",
      };
    }

    if (!settings.api_key || !String(settings.api_key).trim()) {
      return {
        ...base,
        status: "not_configured",
        reason:
          "BDCourier API key not configured. Add the store's own key in fraud settings to activate the external check.",
      };
    }

    const timeoutMs = Math.min(Math.max(settings.timeout_ms || 8000, 1000), 30000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch("https://api.bdcourier.com/courier-check", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.api_key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ phone }),
        signal: controller.signal,
        cache: "no-store",
      });

      if (!res.ok) {
        return {
          ...base,
          status: "unavailable",
          reason: `BDCourier responded with HTTP ${res.status}.`,
        };
      }

      const body: any = await res.json().catch(() => null);
      if (!isRecord(body)) {
        return {
          ...base,
          status: "unavailable",
          reason: "BDCourier returned an unreadable response.",
        };
      }

      // Aggregate the per-courier delivery history when present.
      let totalParcels: number | null = null;
      let deliveredParcels: number | null = null;
      if (isRecord(body.data)) {
        let t = 0;
        let d = 0;
        let seen = false;
        for (const line of Object.values(body.data)) {
          if (!isRecord(line)) continue;
          const lt = num((line as any).total_parcel ?? (line as any).total);
          const ld = num(
            (line as any).success_parcel ?? (line as any).delivered_parcel
          );
          if (lt !== null) {
            t += lt;
            seen = true;
          }
          if (ld !== null) {
            d += ld;
            seen = true;
          }
        }
        if (seen) {
          totalParcels = t;
          deliveredParcels = d;
        }
      }

      const successRatio =
        num(body.success_ratio) ??
        (totalParcels && totalParcels > 0 && deliveredParcels !== null
          ? Math.round((deliveredParcels / totalParcels) * 100)
          : null);

      return {
        ...base,
        status: "ok",
        successRatio,
        riskLevel:
          typeof body.risk_level === "string" ? body.risk_level : null,
        riskVerdict:
          typeof body.risk_verdict === "string" ? body.risk_verdict : null,
        totalParcels,
        deliveredParcels,
      };
    } catch (err: any) {
      return {
        ...base,
        status: "unavailable",
        reason:
          err?.name === "AbortError"
            ? `BDCourier request timed out after ${Math.round(timeoutMs / 1000)}s.`
            : `BDCourier request failed: ${err?.message || "unknown error"}`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Run the check for a placed order and persist the outcome on the
   * order row for the admin order view. Never throws.
   */
  static async runForOrder(orderId: string, phone: string): Promise<void> {
    try {
      const result = await this.checkByPhone(phone);
      const db = createAdminDbClient();
      const { error } = await db
        .from("orders")
        .update({
          fraud_check_status: result.status,
          fraud_check_result: result,
          fraud_checked_at: new Date().toISOString(),
        })
        .eq("id", orderId);
      if (error) {
        console.error(
          `[ExternalFraud] Could not persist result for order ${orderId}:`,
          error.message
        );
      }
    } catch (err) {
      console.error(`[ExternalFraud] Check failed for order ${orderId}:`, err);
    }
  }

  /** Fire-and-forget variant used at checkout. */
  static triggerForOrder(orderId: string, phone: string) {
    if (!orderId || !phone) return;
    Promise.resolve().then(async () => {
      try {
        await this.runForOrder(orderId, phone);
      } catch (err) {
        console.error("[ExternalFraud] Background check error:", err);
      }
    });
  }
}
