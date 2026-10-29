/**
 * Phone OTP sessions for account claiming (Phase 12).
 *
 * Deliberately mirrors the COD OTP infrastructure (lib/services/fraud/
 * cod-otp.service.ts): sessions persist in `cod_verifications`, codes are
 * stored ONLY as HMAC-SHA256 hashes (CodOtpService.hashOtp), never in raw
 * form and never logged. Differences from the COD flow, by design:
 *  - dispatch is by SMS via AlphaSmsService (the real SMS path — the COD
 *    service's built-in SMS provider is an inert stub),
 *  - expiry is 5 minutes (tighter than COD's 10),
 *  - verification delegates to CodOtpService.verifyOtp / isSessionVerified
 *    so attempt counting lives in exactly one place.
 */
import crypto from "crypto";
import { createAdminDbClient } from "@/lib/db/client";
import { CodOtpService } from "@/lib/services/fraud/cod-otp.service";
import { AlphaSmsService } from "@/lib/services/sms/alpha-sms.service";

const EXPIRY_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_RESENDS = 3;
/** After a fully-expired, hour-old session, a fresh OTP cycle may start. */
const CYCLE_RESET_MS = 60 * 60 * 1000;

interface StoredSession {
  session_id: string;
  target_type: string;
  target_value: string;
  otp_hash: string;
  expires_at: string;
  attempts: number;
  max_attempts: number;
  resend_count: number;
  last_sent_at: string;
  verified: boolean;
  verified_at: string | null;
}

export class PhoneOtpService {
  static async getSessionRow(sessionId: string): Promise<StoredSession | null> {
    try {
      const db = createAdminDbClient();
      const { data, error } = await db
        .from("cod_verifications")
        .select("*")
        .eq("session_id", sessionId)
        .maybeSingle();
      if (error || !data) return null;
      return data as StoredSession;
    } catch {
      return null;
    }
  }

  private static async saveSessionRow(row: StoredSession): Promise<void> {
    const db = createAdminDbClient();
    await db
      .from("cod_verifications")
      .upsert(row as any, { onConflict: "session_id" });
  }

  /**
   * Create (or resend) a phone OTP session and dispatch the code by SMS.
   * Enforces the resend cooldown + per-session resend cap; an expired
   * session older than an hour starts a fresh cycle.
   */
  static async initiate(params: {
    sessionId: string;
    phone: string; // normalized 8801XXXXXXXXX
  }): Promise<{
    success: boolean;
    maskedTarget: string;
    remainingCooldownSeconds?: number;
    error?: string;
  }> {
    const { sessionId, phone } = params;
    const maskedTarget = CodOtpService.maskTarget(phone, "phone");
    const now = Date.now();

    const existing = await this.getSessionRow(sessionId);
    let resendCount = 0;

    if (existing && existing.target_value === phone) {
      if (existing.verified) {
        return { success: true, maskedTarget };
      }
      const lastSentAt = new Date(existing.last_sent_at).getTime();
      const expired = now > new Date(existing.expires_at).getTime();
      const cycleStale = expired && now - lastSentAt > CYCLE_RESET_MS;
      if (!cycleStale) {
        const elapsed = now - lastSentAt;
        if (elapsed < RESEND_COOLDOWN_MS) {
          const remaining = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
          return {
            success: false,
            maskedTarget,
            remainingCooldownSeconds: remaining,
            error: `Please wait ${remaining} seconds before requesting another code.`,
          };
        }
        if ((existing.resend_count || 0) >= MAX_RESENDS) {
          return {
            success: false,
            maskedTarget,
            error:
              "Maximum verification resend attempts reached. Please try again later.",
          };
        }
        resendCount = (existing.resend_count || 0) + 1;
      }
    }

    const rawOtp = CodOtpService.generateNumericOtp();
    const row: StoredSession = {
      session_id: sessionId,
      target_type: "phone",
      target_value: phone,
      otp_hash: CodOtpService.hashOtp(rawOtp),
      expires_at: new Date(now + EXPIRY_MS).toISOString(),
      attempts: 0,
      max_attempts: MAX_ATTEMPTS,
      resend_count: resendCount,
      last_sent_at: new Date(now).toISOString(),
      verified: false,
      verified_at: null,
    };
    await this.saveSessionRow(row);

    // Dispatch via the real SMS service. In SMS_TEST_MODE the service logs
    // the message instead of consuming credits (same as order SMS).
    await AlphaSmsService.sendSMS({
      to: phone,
      message: `Anchor Fashion: Your account verification code is ${rawOtp}. Valid for 5 mins. Do not share this code with anyone.`,
      type: "ACCOUNT_CLAIM",
    }).catch((err) => {
      console.warn("[PhoneOtpService] SMS dispatch error:", err);
    });

    return { success: true, maskedTarget };
  }

  /** Verify a code against the session (attempt counting in CodOtpService). */
  static async verify(sessionId: string, code: string) {
    return CodOtpService.verifyOtp(sessionId, code);
  }

  /** Remove a session so a consumed verification cannot be replayed. */
  static async consume(sessionId: string): Promise<void> {
    try {
      const db = createAdminDbClient();
      await db.from("cod_verifications").delete().eq("session_id", sessionId);
    } catch {
      // Non-fatal.
    }
  }

  static newSessionId(prefix: string): string {
    return `${prefix}_${crypto.randomUUID()}`;
  }
}
