"use server";

import { revalidatePath } from "next/cache";
import { createAdminDbClient } from "@/lib/db/client";
import { CourierProviderRecord } from "@/types/shipping.types";
import { CourierRegistry } from "@/services/courier/courier-registry";
import { CourierFactory } from "@/lib/couriers/courier.factory";
import { HealthCheckResult } from "@/lib/couriers/types";
import {
  encrypt,
  decrypt,
  encryptCredentialsObject,
  decryptCredentialsObject,
  maskCredentialsObject,
} from "@/utils/encryption.util";
import { verifyManager } from "@/lib/security/roles";

type ActionResponse<T = void> =
  | { success: true; data?: T }
  | { success: false; error: string };

export interface CourierMetrics {
  courierId: string;
  courierCode: string;
  activeShipments: number;
  pendingCOD: number;
  health?: HealthCheckResult;
}

/**
 * Fetch all courier providers with credentials securely masked
 */
/**
 * Phase 9 fix: the courier_providers table's real columns are
 * (id, code, name, is_active, api_key, api_secret, config). Effective
 * credentials live encrypted in config.credentials, with the encrypted
 * api_key/api_secret columns as fallback (the registry merges them the
 * same way). The previous implementation ordered by a phantom "priority"
 * column, read a phantom "credentials" column (always empty) and spread
 * the raw api_key/api_secret values to the browser. This version returns
 * only masked credentials and derives display fields from real columns.
 */
function effectiveCredentials(row: any): Record<string, any> {
  const config = (row.config ?? {}) as Record<string, any>;
  const creds: Record<string, any> = {
    ...decryptCredentialsObject((config.credentials ?? {}) as Record<string, any>),
  };
  if (creds.apiKey === undefined && row.api_key) {
    creds.apiKey = decrypt(row.api_key);
  }
  if (creds.secretKey === undefined && row.api_secret) {
    creds.secretKey = decrypt(row.api_secret);
  }
  return creds;
}

function sanitizeProvider(row: any): CourierProviderRecord {
  const config = (row.config ?? {}) as Record<string, any>;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    display_name: row.name,
    logo_url: null,
    is_active: row.is_active !== false,
    is_cod_supported: true,
    is_sandbox: !!config.is_sandbox || row.code === "sandbox",
    priority: 0,
    max_weight_kg: null,
    credentials: maskCredentialsObject(effectiveCredentials(row)),
    settings: config.settings ?? {},
    webhook_secret: null,
    supported_zones: null,
    created_at: row.created_at,
    updated_at: row.created_at,
  } as CourierProviderRecord;
}

export async function getCourierProvidersAction(): Promise<
  ActionResponse<CourierProviderRecord[]>
> {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyManager();
  try {
    const db = createAdminDbClient();
    const { data, error } = await db
      .from("courier_providers")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) throw error;

    return { success: true, data: (data || []).map(sanitizeProvider) };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export interface CreateCourierProviderInput {
  code: string;
  name: string;
  apiKey?: string;
  secretKey?: string;
  isSandbox?: boolean;
  isActive?: boolean;
}

const COURIER_CODES = [
  "steadfast",
  "pathao",
  "redx",
  "paperfly",
  "sundarban",
  "ecourier",
  "dhl",
  "fedex",
  "ups",
  "sandbox",
] as const;

/**
 * Create a courier provider (Phase 9 — admin gap build). Phase 8 found the
 * admin could only edit pre-seeded rows: there was NO create path, so a
 * provider like Steadfast could never be added from the dashboard when its
 * API key arrives. Credentials are stored encrypted both in
 * config.credentials and in the api_key/api_secret columns, matching how
 * CourierRegistry reads them.
 */
export async function createCourierProviderAction(
  input: CreateCourierProviderInput
): Promise<ActionResponse<CourierProviderRecord>> {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyManager();
  try {
    const code = (input.code || "").trim().toLowerCase();
    const name = (input.name || "").trim();
    if (!(COURIER_CODES as readonly string[]).includes(code)) {
      return { success: false, error: `Unsupported courier code "${input.code}"` };
    }
    if (!name) return { success: false, error: "Provider name is required" };

    const db = createAdminDbClient();
    const { data: existing } = await db
      .from("courier_providers")
      .select("id")
      .eq("code", code)
      .maybeSingle();
    if (existing) {
      return {
        success: false,
        error: `A provider with code "${code}" already exists — edit it instead`,
      };
    }

    const creds: Record<string, string> = {};
    if (input.apiKey?.trim()) creds.apiKey = input.apiKey.trim();
    if (input.secretKey?.trim()) creds.secretKey = input.secretKey.trim();

    const { data, error } = await db
      .from("courier_providers")
      .insert({
        code,
        name,
        is_active: input.isActive !== false,
        api_key: creds.apiKey ? encrypt(creds.apiKey) : null,
        api_secret: creds.secretKey ? encrypt(creds.secretKey) : null,
        config: {
          is_sandbox: !!input.isSandbox,
          credentials: Object.keys(creds).length
            ? encryptCredentialsObject(creds)
            : {},
        },
      })
      .select()
      .single();
    if (error) throw error;

    CourierRegistry.getInstance().invalidate();
    revalidatePath("/admin/operations/logistics/couriers");
    return { success: true, data: sanitizeProvider(data) };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to create courier provider" };
  }
}

/**
 * Update a courier provider configuration, securely encrypting credentials.
 *
 * Phase 9 fix: this previously wrote a phantom `credentials` column (and a
 * phantom `is_sandbox` column) that the data layer silently dropped, so
 * saving in Courier Settings NEVER persisted anything. Credentials are now
 * persisted where CourierRegistry actually reads them: encrypted in
 * config.credentials, mirrored encrypted into the api_key/api_secret
 * columns; is_sandbox lives in config.is_sandbox.
 */
export async function updateCourierProviderAction(
  id: string,
  updates: Partial<CourierProviderRecord>
): Promise<ActionResponse<void>> {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyManager();
  try {
    const adminDb = createAdminDbClient();

    const { data: existing, error: fetchError } = await adminDb
      .from("courier_providers")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!existing) return { success: false, error: "Courier provider not found" };

    const existingConfig = (existing.config ?? {}) as Record<string, any>;
    const nextConfig: Record<string, any> = { ...existingConfig };

    const dbPayload: Record<string, any> = {};
    if (typeof updates.name === "string" && updates.name.trim()) {
      dbPayload.name = updates.name.trim();
    }
    if (typeof updates.is_active === "boolean") {
      dbPayload.is_active = updates.is_active;
    }
    if (typeof (updates as any).is_sandbox === "boolean") {
      nextConfig.is_sandbox = (updates as any).is_sandbox;
    }

    const credentials = (updates as any).credentials;
    if (credentials !== undefined && typeof credentials === "object") {
      const credEntries = Object.entries(credentials);
      const isExplicitEmpty = credEntries.length === 0;
      const allValuesEmpty = credEntries.every(
        ([_, val]) => typeof val === "string" && val.trim() === ""
      );

      let mergedCreds: Record<string, any>;
      if (isExplicitEmpty || allValuesEmpty) {
        // Explicitly clear all credentials
        mergedCreds = {};
      } else {
        mergedCreds = { ...effectiveCredentials(existing) };
        for (const [key, val] of credEntries) {
          if (typeof val === "string") {
            // Masked values (e.g. "••••••••9X21") leave the stored value unchanged
            if (val.startsWith("••••••••")) continue;
            if (val.trim() === "") delete mergedCreds[key];
            else mergedCreds[key] = val;
          } else if (val === null || val === undefined) {
            delete mergedCreds[key];
          } else {
            mergedCreds[key] = val;
          }
        }
      }

      const hasValues = Object.values(mergedCreds).some(
        (v) => typeof v === "string" && v.trim() !== ""
      );
      nextConfig.credentials = hasValues ? encryptCredentialsObject(mergedCreds) : {};
      dbPayload.api_key =
        hasValues && mergedCreds.apiKey ? encrypt(String(mergedCreds.apiKey)) : null;
      dbPayload.api_secret =
        hasValues && mergedCreds.secretKey
          ? encrypt(String(mergedCreds.secretKey))
          : null;
    }

    dbPayload.config = nextConfig;

    const { error } = await adminDb
      .from("courier_providers")
      .update(dbPayload)
      .eq("id", id);

    if (error) throw error;

    // Invalidate registry cache
    CourierRegistry.getInstance().invalidate();

    revalidatePath("/admin/operations/logistics/couriers");
    revalidatePath("/admin/shipping/couriers");
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Performs a live health check on a courier provider
 */
export async function testCourierConnectionAction(
  courierId: string,
  credentialsToTest?: Record<string, any>,
  isSandbox?: boolean
): Promise<ActionResponse<HealthCheckResult>> {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyManager();
  try {
    const { provider: dbProvider, record } = await CourierFactory.getProviderFromDatabase(courierId);

    let provider = dbProvider;
    if (credentialsToTest !== undefined) {
      const credEntries = Object.entries(credentialsToTest);
      const isExplicitEmpty = credEntries.length === 0;
      const allValuesEmpty = credEntries.every(
        ([_, val]) => typeof val === "string" && val.trim() === ""
      );

      if (isExplicitEmpty || allValuesEmpty) {
        provider = CourierFactory.getProvider(
          record.code as any,
          {},
          {
            environment:
              isSandbox !== undefined
                ? isSandbox
                  ? "sandbox"
                  : "production"
                : record.is_sandbox
                ? "sandbox"
                : "production",
            storeId: "",
            webhookSecret: record.webhook_secret,
          }
        );
      } else {
        // Merge with existing decrypted DB credentials in case some fields are masked (e.g. ••••••••)
        const existingDecrypted = decryptCredentialsObject(record.credentials || {});
        const merged: Record<string, any> = { ...existingDecrypted };

        for (const [key, val] of credEntries) {
          if (typeof val === "string") {
            if (val.startsWith("••••••••")) {
              continue;
            }
            if (val.trim() === "") {
              delete merged[key];
            } else {
              merged[key] = val;
            }
          } else if (val === null || val === undefined) {
            delete merged[key];
          } else {
            merged[key] = val;
          }
        }

        provider = CourierFactory.getProvider(
          record.code as any,
          merged,
          {
            environment:
              isSandbox !== undefined
                ? isSandbox
                  ? "sandbox"
                  : "production"
                : record.is_sandbox
                ? "sandbox"
                : "production",
            storeId: merged.storeId || merged.store_id || record.settings?.storeId,
            webhookSecret: record.webhook_secret,
          }
        );
      }
    }

    const health = await provider.healthCheck();
    return { success: true, data: health };
  } catch (err: any) {
    return {
      success: true,
      data: {
        status: "unhealthy",
        responseTime: 0,
        lastCheckedAt: new Date().toISOString(),
        message: err.message || "Failed to connect to courier API",
      },
    };
  }
}

/**
 * Calculate real active shipment counts and real pending COD from database
 */
export async function getCourierMetricsAction(): Promise<
  ActionResponse<Record<string, CourierMetrics>>
> {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyManager();
  try {
    const db = createAdminDbClient();

    // 1. Fetch all providers
    const { data: providers, error: provError } = await db
      .from("courier_providers")
      .select("id, code");

    if (provError) throw provError;

    // 2. Fetch shipments
    const { data: shipments, error: shipError } = await db
      .from("shipments")
      .select("courier_provider_code, status, cod_amount, is_cod");

    if (shipError) {
      console.warn("Could not query shipments for metrics:", shipError.message);
    }

    const activeStatuses = new Set([
      "created",
      "pickup_requested",
      "pickup_confirmed",
      "picked_up",
      "in_transit",
      "hub_received",
      "out_for_delivery",
      "on_hold",
    ]);

    const metricsMap: Record<string, CourierMetrics> = {};

    for (const p of providers || []) {
      const code = p.code?.toLowerCase();
      let activeCount = 0;
      let pendingCOD = 0;

      for (const s of shipments || []) {
        if (s.courier_provider_code?.toLowerCase() === code) {
          const status = (s.status || "").toLowerCase();
          if (activeStatuses.has(status)) {
            activeCount++;
          }
          // Delivered COD orders awaiting settlement
          if (status === "delivered" && (s.is_cod || Number(s.cod_amount) > 0)) {
            pendingCOD += Number(s.cod_amount) || 0;
          }
        }
      }

      metricsMap[p.id] = {
        courierId: p.id,
        courierCode: p.code,
        activeShipments: activeCount,
        pendingCOD: Math.round(pendingCOD),
      };
    }

    return { success: true, data: metricsMap };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Fetches recent API logs for a given courier code
 */
export async function getCourierLogsAction(
  courierCode?: string,
  limit = 50
): Promise<ActionResponse<any[]>> {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyManager();
  try {
    const db = createAdminDbClient();
    let query = db
      .from("courier_api_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (courierCode) {
      query = query.eq("courier_code", courierCode);
    }

    const { data, error } = await query;
    if (error) {
      // Table may not exist yet in schema cache
      return { success: true, data: [] };
    }

    return { success: true, data: data || [] };
  } catch {
    return { success: true, data: [] };
  }
}
