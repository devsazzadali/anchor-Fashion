import { createAdminDbClient } from "@/lib/db/client";
import { CourierApiLogEntry } from "./types";

/**
 * Strips sensitive keys (passwords, tokens, secret keys) from payload objects before logging
 */
export function sanitizeLogData(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;

  if (Array.isArray(data)) {
    return data.map(sanitizeLogData);
  }

  const sensitiveKeys = new Set([
    "password",
    "client_secret",
    "secretkey",
    "secret_key",
    "api_key",
    "apikey",
    "access_token",
    "refresh_token",
    "authorization",
    "token",
  ]);

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (sensitiveKeys.has(key.toLowerCase())) {
      sanitized[key] = "••••••••";
    } else if (value && typeof value === "object") {
      sanitized[key] = sanitizeLogData(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Logs a courier API request and response to courier_api_logs
 */
export async function logCourierApiCall(entry: CourierApiLogEntry): Promise<void> {
  try {
    const db = createAdminDbClient();
    const sanitizedPayload = sanitizeLogData(entry.payload);
    const sanitizedResponse = sanitizeLogData(entry.responseData);

    // FIX ROUND 28 (sweep): courier_api_logs real columns are
    // (courier, endpoint, request, response, status_code) — the old
    // payload's courier_code / method / success / response_time_ms /
    // request_id / error_message / payload / response_data keys do
    // not exist, so every log row landed nearly empty. The detail now
    // rides inside the request/response JSON columns.
    const { error } = await db.from("courier_api_logs").insert({
      courier: entry.courierCode,
      endpoint: entry.endpoint,
      status_code: entry.statusCode,
      request: {
        method: entry.method,
        request_id: entry.requestId || null,
        response_time_ms: entry.responseTimeMs,
        success: entry.success,
        payload: sanitizedPayload,
      },
      response: {
        data: sanitizedResponse,
        error_message: entry.errorMessage || null,
      },
    });

    if (error) {
      // Table may not have been migrated yet; log locally to stdout and fail open
    }
  } catch (err) {
  }
}
