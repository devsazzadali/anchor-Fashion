import { createAdminDbClient } from "@/lib/db/client";
import { logServerError } from "@/lib/utils/error-handler";

interface MemoryOtpRecord {
  email: string;
  otp: string;
  expires_at: number; // timestamp ms
  created_at: number; // timestamp ms
}

// Global persistent in-memory fallback store (survives hot reloads in dev/edge)
const memoryStore = new Map<string, MemoryOtpRecord[]>();

/**
 * REG-78: verify-attempt limiting, mirroring the COD OTP service
 * (lib/services/fraud/cod-otp.service.ts): a code tolerates at most
 * MAX_VERIFY_ATTEMPTS wrong guesses; reaching the cap INVALIDATES the
 * code (in both stores) and locks verification for that email until a
 * new code is requested. Previously verify had no attempt accounting at
 * all, so a 6-digit code was online-brute-forceable.
 */
const MAX_VERIFY_ATTEMPTS = 5;
const VERIFY_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

interface VerifyAttemptState {
  count: number;
  windowStartedAt: number;
  locked: boolean;
}

const verifyAttempts = new Map<string, VerifyAttemptState>();

function getVerifyAttemptState(email: string, nowMs: number): VerifyAttemptState {
  const existing = verifyAttempts.get(email);
  if (existing && nowMs - existing.windowStartedAt < VERIFY_ATTEMPT_WINDOW_MS) {
    return existing;
  }
  const fresh: VerifyAttemptState = { count: 0, windowStartedAt: nowMs, locked: false };
  verifyAttempts.set(email, fresh);
  return fresh;
}

/** Deletes every stored code for the email from both stores. */
async function invalidateAllOtpsForEmail(
  db: ReturnType<typeof createAdminDbClient>,
  email: string
): Promise<void> {
  memoryStore.delete(email);
  try {
    await db.from("registration_otps").delete().eq("email", email);
  } catch {
    // Non-fatal: the memory-side invalidation and the lock flag still hold.
  }
}

export const OtpStore = {
  /**
   * Check rate-limit and abuse count for the given email
   */
  async checkRateLimit(
    email: string,
    rateLimitSeconds: number = 60,
    maxAttempts: number = 5,
    windowMinutes: number = 15
  ): Promise<{ rateLimited: boolean; remainingSeconds: number; abuseExceeded: boolean }> {
    const db = createAdminDbClient();
    const nowMs = Date.now();
    const abuseCutoff = new Date(nowMs - windowMinutes * 60 * 1000).toISOString();

    try {
      const { data: recentOtps, error } = await db
        .from("registration_otps")
        .select("id, created_at")
        .eq("email", email)
        .gte("created_at", abuseCutoff)
        .order("created_at", { ascending: false });

      if (!error && recentOtps) {
        if (recentOtps.length > 0) {
          const latestTime = new Date(recentOtps[0].created_at).getTime();
          const elapsed = (nowMs - latestTime) / 1000;
          if (elapsed < rateLimitSeconds) {
            return {
              rateLimited: true,
              remainingSeconds: Math.ceil(rateLimitSeconds - elapsed),
              abuseExceeded: false,
            };
          }
          if (recentOtps.length >= maxAttempts) {
            return { rateLimited: false, remainingSeconds: 0, abuseExceeded: true };
          }
        }
        return { rateLimited: false, remainingSeconds: 0, abuseExceeded: false };
      }
    } catch {
      // Fallback to memory store below
    }

    // Memory store fallback check
    const records = (memoryStore.get(email) || []).filter(
      (r) => nowMs - r.created_at < windowMinutes * 60 * 1000
    );
    memoryStore.set(email, records);

    if (records.length > 0) {
      const latest = records[records.length - 1];
      const elapsed = (nowMs - latest.created_at) / 1000;
      if (elapsed < rateLimitSeconds) {
        return {
          rateLimited: true,
          remainingSeconds: Math.ceil(rateLimitSeconds - elapsed),
          abuseExceeded: false,
        };
      }
      if (records.length >= maxAttempts) {
        return { rateLimited: false, remainingSeconds: 0, abuseExceeded: true };
      }
    }

    return { rateLimited: false, remainingSeconds: 0, abuseExceeded: false };
  },

  /**
   * Save a newly generated OTP with expiry.
   * A new code supersedes every earlier code for the email (single
   * active code, like the COD OTP session model) and resets the
   * verify-attempt counter.
   */
  async saveOtp(email: string, otp: string, expiresAt: Date): Promise<boolean> {
    const db = createAdminDbClient();
    const now = new Date();

    // Reset verify attempts + lockout: a fresh code starts a fresh window.
    verifyAttempts.delete(email);

    // Memory store: replace any previous codes with only the new one.
    memoryStore.set(email, [
      {
        email,
        otp,
        expires_at: expiresAt.getTime(),
        created_at: now.getTime(),
      },
    ]);

    // Attempt writing to registration_otps in database
    try {
      // Single active code: remove earlier rows for this email first.
      try {
        await db.from("registration_otps").delete().eq("email", email);
      } catch {
        // Non-fatal: the insert below still proceeds.
      }
      const { error } = await db.from("registration_otps").insert([
        {
          email,
          otp,
          expires_at: expiresAt.toISOString(),
          created_at: now.toISOString(),
        },
      ]);

      if (error) {
        // If table does not exist in schema cache, log warning and use memory fallback
        if (error.code === "PGRST205" || (error as any).code === "42P01") {
          console.warn("[OtpStore] registration_otps table not in DB, operating via secure in-memory cache.");
          return true;
        }
        logServerError("OTP_STORE_SAVE", error, { email });
        return true; // Still return true because memoryStore recorded it
      }
      return true;
    } catch (err) {
      logServerError("OTP_STORE_EXCEPTION", err, { email });
      return true;
    }
  },

  /**
   * Verify an OTP and atomically consume/invalidate it.
   * Wrong guesses are counted (REG-78): at MAX_VERIFY_ATTEMPTS the code
   * is invalidated in both stores and further verifies are refused —
   * even with the correct code — until a new code is requested.
   */
  async verifyAndConsumeOtp(
    email: string,
    otp: string
  ): Promise<{ success: boolean; error?: string }> {
    const db = createAdminDbClient();
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const attemptState = getVerifyAttemptState(email, nowMs);

    // Locked out from an earlier burst: refuse before looking anything up.
    if (attemptState.locked) {
      return {
        success: false,
        error:
          "Too many failed attempts. This verification code has been invalidated. Please request a new code.",
      };
    }

    let dbChecked = false;
    let dbSuccess = false;

    // 1. Try checking database table
    try {
      const { data: records, error } = await db
        .from("registration_otps")
        .select("id, email, otp, expires_at")
        .eq("email", email)
        .eq("otp", otp)
        .gte("expires_at", nowIso)
        .order("created_at", { ascending: false })
        .limit(1);

      if (!error) {
        dbChecked = true;
        if (records && records.length > 0) {
          dbSuccess = true;
          // Invalidate immediately
          await db.from("registration_otps").delete().eq("email", email);
        }
      }
    } catch {
      // Non-fatal, check memory store below
    }

    if (dbSuccess) {
      // Clear memory cache and the attempt counter as well
      memoryStore.delete(email);
      verifyAttempts.delete(email);
      return { success: true };
    }

    // 2. Check memory store fallback
    const records = memoryStore.get(email) || [];
    const matchedIdx = records.findIndex((r) => r.otp === otp);

    if (matchedIdx !== -1) {
      const record = records[matchedIdx];
      if (nowMs > record.expires_at) {
        // Expired — a stale code is not a guess; it does not consume an attempt.
        records.splice(matchedIdx, 1);
        memoryStore.set(email, records);
        return {
          success: false,
          error: "This verification code has expired. Please request a new code.",
        };
      }

      // Valid: Invalidate all OTPs for this email to prevent reuse
      memoryStore.delete(email);
      verifyAttempts.delete(email);
      if (dbChecked) {
        try {
          await db.from("registration_otps").delete().eq("email", email);
        } catch {
          // ignore
        }
      }
      return { success: true };
    }

    // Check if any expired record existed in memory
    const expiredRecord = records.find((r) => r.otp === otp && nowMs > r.expires_at);
    if (expiredRecord) {
      return {
        success: false,
        error: "This verification code has expired. Please request a new code.",
      };
    }

    // 3. Wrong code: count the attempt (REG-78, mirroring the COD OTP cap).
    attemptState.count += 1;
    if (attemptState.count >= MAX_VERIFY_ATTEMPTS) {
      attemptState.locked = true;
      await invalidateAllOtpsForEmail(db, email);
      return {
        success: false,
        error:
          "Too many failed attempts. This verification code has been invalidated. Please request a new code.",
      };
    }

    const remainingAttempts = MAX_VERIFY_ATTEMPTS - attemptState.count;
    return {
      success: false,
      error: `Invalid verification code. ${remainingAttempts} attempt${remainingAttempts === 1 ? "" : "s"} remaining.`,
    };
  },
};
