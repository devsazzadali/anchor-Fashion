import crypto from "crypto";
import { createAdminDbClient } from "@/lib/db/client";
import { EmailProvider } from "@/lib/notifications/EmailProvider";
import { CodRiskService } from "./cod-risk.service";

export interface VerificationSession {
  sessionId: string;
  targetType: "email" | "phone";
  targetValue: string;
  /** A3-A3: the phone supplied when the code was requested (persisted
   * in cod_verifications.phone) so order placement can bind the
   * verification to the order's phone as well as its dispatch target. */
  phone?: string | null;
  otpHash: string;
  expiresAt: number; // timestamp ms
  attempts: number;
  maxAttempts: number;
  resendCount: number;
  lastSentAt: number; // timestamp ms
  verified: boolean;
  verifiedAt?: number;
}

// In-memory fallback store to ensure resilience if DB table is unmigrated or in edge runtime
const memoryVerificationStore = new Map<string, VerificationSession>();

export interface ISmsProvider {
  sendSms(to: string, message: string): Promise<{ success: boolean; messageId?: string; error?: string }>;
}

export class DefaultSmsProvider implements ISmsProvider {
  async sendSms(to: string, message: string) {
    // Note: Live SMS delivery requires external SMS gateway provider credentials (e.g., SSL Wireless, Greenweb, Twilio).
    // Do not fabricate fake SMS success.
    return {
      success: false,
      error: "SMS provider credentials not configured. Using verified email dispatch fallback.",
    };
  }
}

export class CodOtpService {
  private static smsProvider: ISmsProvider = new DefaultSmsProvider();

  /**
   * A3-A7: per-TARGET send caps. The per-session cooldown/resend caps
   * are bypassed by minting a fresh session per request, so sends are
   * additionally accounted per destination (email / phone) across all
   * sessions: at most TARGET_MAX_SENDS sends to one target inside the
   * rolling window, no matter how many sessions were created.
   */
  private static readonly TARGET_SEND_WINDOW_MS = 60 * 60 * 1000;
  private static readonly TARGET_MAX_SENDS = 5;
  private static targetSendLog = new Map<string, number[]>();

  private static targetKey(raw: string): string {
    const trimmed = (raw || "").trim().toLowerCase();
    if (trimmed.includes("@")) return `email:${trimmed}`;
    const digits = trimmed.replace(/\D/g, "");
    return `phone:${digits.slice(-11)}`;
  }

  private static checkTargetSendAllowance(rawTarget: string): boolean {
    if (!rawTarget) return true;
    const key = this.targetKey(rawTarget);
    const now = Date.now();
    const recent = (this.targetSendLog.get(key) || []).filter(
      (t) => now - t < this.TARGET_SEND_WINDOW_MS
    );
    this.targetSendLog.set(key, recent);
    return recent.length < this.TARGET_MAX_SENDS;
  }

  private static recordTargetSend(rawTarget: string): void {
    if (!rawTarget) return;
    const key = this.targetKey(rawTarget);
    const recent = this.targetSendLog.get(key) || [];
    recent.push(Date.now());
    this.targetSendLog.set(key, recent);
  }

  /**
   * Derive a stable HMAC secret for OTP hashing
   */
  private static getHashSecret(): string {
    const secret =
      process.env.COD_OTP_HMAC_SECRET || process.env.NEXTAUTH_SECRET;
    if (!secret) {
      throw new Error(
        "COD OTP hashing secret is not configured: set COD_OTP_HMAC_SECRET (or NEXTAUTH_SECRET)."
      );
    }
    return secret;
  }

  /**
   * Hashes an OTP using SHA-256 HMAC so raw OTPs are never stored in the database or cache.
   */
  static hashOtp(otp: string): string {
    return crypto
      .createHmac("sha256", this.getHashSecret())
      .update(otp.trim())
      .digest("hex");
  }

  /**
   * Generate a cryptographically secure 6-digit numeric OTP
   */
  static generateNumericOtp(): string {
    return crypto.randomInt(100000, 1000000).toString();
  }

  /**
   * Masks email or phone number for safe client display
   */
  static maskTarget(target: string, type: "email" | "phone" = "email"): string {
    if (type === "email" || target.includes("@")) {
      const [local, domain] = target.split("@");
      if (!domain) return target;
      if (local.length <= 2) return `${local[0]}***@${domain}`;
      return `${local[0]}***${local[local.length - 1]}@${domain}`;
    } else {
      const digits = target.replace(/\D/g, "");
      if (digits.length < 6) return target;
      return `${digits.slice(0, 3)}****${digits.slice(-3)}`;
    }
  }

  /**
   * Send a COD Verification OTP to the customer.
   */
  static async initiateVerification(params: {
    sessionId: string;
    email: string;
    phone?: string;
    customerName?: string;
    orderTotal?: number;
  }): Promise<{
    success: boolean;
    sessionId: string;
    maskedTarget: string;
    targetType: "email" | "phone";
    remainingCooldownSeconds?: number;
    /** REG-45: the fresh code's lifetime, so the client countdown can be
     * armed from the server's actual config instead of a hardcoded guess. */
    expirySeconds?: number;
    error?: string;
  }> {
    const config = await CodRiskService.getConfig();
    const now = Date.now();
    const expiresAt = now + config.otp_expiry_minutes * 60 * 1000;

    // Determine primary target: prioritize email where Resend is live
    const targetType: "email" | "phone" = params.email ? "email" : "phone";
    const targetValue = params.email ? params.email.toLowerCase().trim() : (params.phone || "").trim();

    // Check existing session for resend cooldown and limits
    let session = await this.getSession(params.sessionId);

    if (session) {
      // If already verified FOR THIS identity, do not send another OTP.
      // A3-A3: if the caller is now asking for a DIFFERENT phone/email
      // than the verified one, the old verification must not carry over
      // — fall through and issue a fresh code bound to the new identity
      // (the overwrite below resets verified=false), otherwise a
      // customer who edits their phone after verifying would loop
      // forever against a verification earned on the old identity.
      if (session.verified) {
        const sameTarget =
          this.normalizeIdentity(session.targetValue) ===
          this.normalizeIdentity(targetValue);
        const samePhone =
          !session.phone ||
          !params.phone ||
          this.normalizeIdentity(session.phone) ===
            this.normalizeIdentity(params.phone);
        if (sameTarget && samePhone) {
          return {
            success: true,
            sessionId: params.sessionId,
            maskedTarget: this.maskTarget(targetValue, targetType),
            targetType,
            expirySeconds: config.otp_expiry_minutes * 60,
          };
        }
      }

      // Check resend cooldown
      const elapsedSeconds = Math.floor((now - session.lastSentAt) / 1000);
      if (elapsedSeconds < config.otp_resend_cooldown_seconds) {
        const remaining = config.otp_resend_cooldown_seconds - elapsedSeconds;
        return {
          success: false,
          sessionId: params.sessionId,
          maskedTarget: this.maskTarget(targetValue, targetType),
          targetType,
          remainingCooldownSeconds: remaining,
          error: `Please wait ${remaining} seconds before requesting another code.`,
        };
      }

      // Check max resends (max 3 resends per session)
      if (session.resendCount >= 3) {
        return {
          success: false,
          sessionId: params.sessionId,
          maskedTarget: this.maskTarget(targetValue, targetType),
          targetType,
          error: "Maximum verification resend attempts reached. Please contact customer support.",
        };
      }
    }

    // A3-A7: per-target cap check BEFORE anything is generated or sent —
    // a target that has exhausted its hourly allowance gets an honest
    // refusal regardless of how fresh this session is.
    const sendTargets = [params.email || "", params.phone || ""].filter(
      Boolean
    );
    for (const target of sendTargets) {
      if (!this.checkTargetSendAllowance(target)) {
        return {
          success: false,
          sessionId: params.sessionId,
          maskedTarget: this.maskTarget(targetValue, targetType),
          targetType,
          error:
            "Too many verification codes have been sent to this contact. Please wait before requesting another code.",
        };
      }
    }

    // Generate new secure 6-digit OTP
    const rawOtp = this.generateNumericOtp();
    const otpHash = this.hashOtp(rawOtp);

    const updatedSession: VerificationSession = {
      sessionId: params.sessionId,
      targetType,
      targetValue,
      phone: params.phone || null,
      otpHash,
      expiresAt,
      attempts: 0,
      maxAttempts: config.otp_max_attempts,
      resendCount: session ? session.resendCount + 1 : 0,
      lastSentAt: now,
      verified: false,
    };

    // Save session in cache and DB
    await this.saveSession(updatedSession);

    // Dispatch OTP via configured providers. A3-A2: every channel's
    // result is captured — delivery success is only reported when at
    // least one channel actually delivered (see the end of this method).
    let emailDelivered = false;
    let smsDelivered = false;
    let emailError: string | undefined;
    let smsError: string | undefined;

    // 1. Email Dispatch via live Resend provider
    if (params.email) {
      const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Order Verification Code - Anchor Fashion</title>
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 32px 16px;">
          <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 520px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); border: 1px solid #e2e8f0;">
            <tr>
              <td style="padding: 32px 40px 24px; text-align: center; background-color: #0f172a;">
                <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 800; letter-spacing: 2px;">ANCHOR FASHION</h1>
                <p style="margin: 4px 0 0; color: #94a3b8; font-size: 13px; text-transform: uppercase; letter-spacing: 1px;">Cash on Delivery Verification</p>
              </td>
            </tr>
            <tr>
              <td style="padding: 36px 40px;">
                <h2 style="margin: 0 0 16px; color: #1e293b; font-size: 18px; font-weight: 600;">Confirm Your Cash on Delivery Order</h2>
                <p style="margin: 0 0 20px; color: #475569; font-size: 14px; line-height: 24px;">
                  Hello${params.customerName ? " " + params.customerName : ""},<br>
                  To confirm your Cash on Delivery order${params.orderTotal ? " of <strong>৳" + params.orderTotal.toLocaleString() + "</strong>" : ""} and protect against unauthorized orders, please use the 6-digit verification code below:
                </p>
                <div style="background-color: #f1f5f9; border-radius: 8px; padding: 24px; text-align: center; margin: 24px 0; border: 1px dashed #cbd5e1;">
                  <span style="font-family: 'Courier New', Courier, monospace; font-size: 38px; font-weight: 700; letter-spacing: 10px; color: #0f172a; display: inline-block; margin-left: 10px;">
                    ${rawOtp}
                  </span>
                </div>
                <p style="margin: 0 0 10px; color: #64748b; font-size: 13px; line-height: 20px;">
                  ⏱️ This code will expire in <strong>${config.otp_expiry_minutes} minutes</strong>.
                </p>
                <p style="margin: 0 0 24px; color: #94a3b8; font-size: 13px; line-height: 20px;">
                  If you did not place this order with Anchor Fashion, please ignore this email or contact support. Never share this code with anyone.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding: 20px 40px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center;">
                <p style="margin: 0; color: #94a3b8; font-size: 12px;">
                  &copy; ${new Date().getFullYear()} Anchor Fashion Ltd. Dhaka, Bangladesh.
                </p>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `;

      try {
        const sendResult = await EmailProvider.send({
          to: params.email,
          subject: `Anchor Fashion: Your Order Verification Code is ${rawOtp}`,
          html: emailHtml,
          text: `Your Anchor Fashion Cash on Delivery verification code is ${rawOtp}. Valid for ${config.otp_expiry_minutes} minutes.`,
        });

        if (sendResult.error) {
          emailError =
            typeof sendResult.error === "string"
              ? sendResult.error
              : "Email delivery failed.";
        } else {
          emailDelivered = true;
          this.recordTargetSend(params.email);
        }
      } catch (mailErr) {
        emailError = (mailErr as Error)?.message || "Email delivery failed.";
      }
    }

    // 2. SMS Dispatch via the configured provider
    if (params.phone) {
      try {
        const smsResult = await this.smsProvider.sendSms(
          params.phone,
          `Anchor Fashion: Your order verification code is ${rawOtp}. Valid for ${config.otp_expiry_minutes} mins.`
        );
        if (smsResult && smsResult.success) {
          smsDelivered = true;
          this.recordTargetSend(params.phone);
        } else {
          smsError =
            smsResult?.error || "SMS delivery failed.";
        }
      } catch (smsErr) {
        smsError = (smsErr as Error)?.message || "SMS delivery failed.";
      }
    }

    // A3-A2: NEVER report success when nothing was delivered. Previously
    // the email result was dropped into an empty if-block, the SMS
    // result was not even captured, and this method returned
    // success:true unconditionally — so a phone-target session (whose
    // only channel is the SMS provider) told the customer "code sent"
    // while no code ever left the building, silently stalling the
    // risk-gated checkout. Now: if every attempted channel failed, the
    // undelivered session is discarded (so a retry is not cooldown-
    // blocked by a code nobody received) and the failure propagates to
    // the caller as an honest error.
    if (!emailDelivered && !smsDelivered) {
      await this.deleteSession(params.sessionId);
      const failureDetail =
        targetType === "phone" ? smsError || emailError : emailError || smsError;
      return {
        success: false,
        sessionId: params.sessionId,
        maskedTarget: this.maskTarget(targetValue, targetType),
        targetType,
        error: `We could not send your verification code. ${failureDetail || "Delivery provider unavailable."} Please try again or contact customer support.`,
      };
    }

    return {
      success: true,
      sessionId: params.sessionId,
      maskedTarget: this.maskTarget(targetValue, targetType),
      targetType,
      expirySeconds: config.otp_expiry_minutes * 60,
    };
  }

  /**
   * Verify an OTP submitted by the user.
   */
  static async verifyOtp(
    sessionId: string,
    enteredOtp: string
  ): Promise<{ success: boolean; error?: string }> {
    const session = await this.getSession(sessionId);

    if (!session) {
      return {
        success: false,
        error: "Verification session not found or expired. Please request a new code.",
      };
    }

    if (session.verified) {
      return { success: true };
    }

    const now = Date.now();

    // Check expiration
    if (now > session.expiresAt) {
      return {
        success: false,
        error: "Verification code has expired. Please request a new code.",
      };
    }

    // Check attempt limits
    if (session.attempts >= session.maxAttempts) {
      return {
        success: false,
        error: "Too many failed attempts. For your security, this verification code has been invalidated. Please request a new code.",
      };
    }

    // Compute submitted hash
    const submittedHash = this.hashOtp(enteredOtp);

    // Timing-safe hash comparison (both values are HMAC-SHA256 hex;
    // a plain !== leaks prefix-match timing against the stored hash).
    const submittedBuf = Buffer.from(submittedHash);
    const storedBuf = Buffer.from(session.otpHash ?? "");
    const hashMatches =
      submittedBuf.length === storedBuf.length &&
      crypto.timingSafeEqual(submittedBuf, storedBuf);

    if (!hashMatches) {
      // Increment attempt count
      session.attempts += 1;
      await this.saveSession(session);

      const remainingAttempts = session.maxAttempts - session.attempts;
      if (remainingAttempts <= 0) {
        return {
          success: false,
          error: "Too many failed attempts. This verification code has been invalidated. Please request a new code.",
        };
      }

      return {
        success: false,
        error: `Incorrect verification code. ${remainingAttempts} attempt${remainingAttempts === 1 ? "" : "s"} remaining.`,
      };
    }

    // Verification successful: atomically mark as verified
    session.verified = true;
    session.verifiedAt = now;
    await this.saveSession(session);

    return { success: true };
  }

  /**
   * Check whether a given session has been successfully verified
   */
  static async isSessionVerified(sessionId: string): Promise<boolean> {
    const session = await this.getSession(sessionId);
    return !!session?.verified;
  }

  /**
   * A3-A3: return the verified session (with the identity the code was
   * actually sent to) so order placement can BIND the verification to
   * the order's own phone/email. A session verified against identity A
   * must never validate an order placed under identity B.
   */
  static async getVerifiedSession(
    sessionId: string
  ): Promise<VerificationSession | null> {
    const session = await this.getSession(sessionId);
    return session?.verified ? session : null;
  }

  /** Normalize an email/phone identity for binding comparisons. */
  static normalizeIdentity(raw?: string | null): string {
    const trimmed = (raw || "").trim().toLowerCase();
    if (trimmed.includes("@")) return trimmed;
    const digits = trimmed.replace(/\D/g, "");
    return digits.slice(-11);
  }

  /**
   * A3-A3 binding check: does this verified session belong to THIS
   * order's identity? BOTH conditions must hold:
   *  1. the session's verified dispatch target matches the order's
   *     corresponding field (email target ↔ order email, phone target
   *     ↔ order phone), and
   *  2. when a phone was recorded at dispatch time, it matches the
   *     order's phone.
   * So verifying a code sent to your own email and then submitting an
   * order under a victim's phone (or vice versa) does NOT validate.
   */
  static async isSessionBoundToOrder(
    sessionId: string,
    orderIdentity: { phone?: string | null; email?: string | null }
  ): Promise<boolean> {
    const session = await this.getVerifiedSession(sessionId);
    if (!session) return false;
    const target = this.normalizeIdentity(session.targetValue);
    if (!target) return false;
    const phone = this.normalizeIdentity(orderIdentity.phone);
    const email = this.normalizeIdentity(orderIdentity.email);
    const targetMatches =
      session.targetType === "email" ? target === email : target === phone;
    if (!targetMatches) return false;
    if (session.phone) {
      if (this.normalizeIdentity(session.phone) !== phone) return false;
    }
    return true;
  }

  /**
   * Remove a session (memory + DB, best effort). Used when dispatch
   * failed on every channel: the customer never received a code, so
   * the session must not sit there imposing cooldowns on a retry.
   */
  private static async deleteSession(sessionId: string): Promise<void> {
    memoryVerificationStore.delete(sessionId);
    try {
      const db = createAdminDbClient();
      await db.from("cod_verifications").delete().eq("session_id", sessionId);
    } catch {
      // Best effort — the memory copy is already gone.
    }
  }

  /**
   * Fetch session from DB with memory fallback
   */
  private static async getSession(sessionId: string): Promise<VerificationSession | null> {
    // 1. Check memory cache first
    const cached = memoryVerificationStore.get(sessionId);
    if (cached) return cached;

    // 2. Check DB
    try {
      const db = createAdminDbClient();
      const { data, error } = await db
        .from("cod_verifications")
        .select("*")
        .eq("session_id", sessionId)
        .maybeSingle();

      if (!error && data) {
        const session: VerificationSession = {
          sessionId: data.session_id,
          targetType: data.target_type,
          targetValue: data.target_value,
          phone: data.phone || null,
          otpHash: data.otp_hash,
          expiresAt: new Date(data.expires_at).getTime(),
          attempts: data.attempts || 0,
          maxAttempts: data.max_attempts || 5,
          resendCount: data.resend_count || 0,
          lastSentAt: new Date(data.last_sent_at).getTime(),
          verified: data.verified || false,
          verifiedAt: data.verified_at ? new Date(data.verified_at).getTime() : undefined,
        };
        memoryVerificationStore.set(sessionId, session);
        return session;
      }
    } catch {
      // Fallback to null
    }

    return null;
  }

  /**
   * Save session to DB and memory cache
   */
  private static async saveSession(session: VerificationSession): Promise<void> {
    // Always store in memory cache
    memoryVerificationStore.set(session.sessionId, session);

    // Attempt writing to DB
    try {
      const db = createAdminDbClient();
      await db.from("cod_verifications").upsert(
        {
          session_id: session.sessionId,
          target_type: session.targetType,
          target_value: session.targetValue,
          phone: session.phone || null,
          otp_hash: session.otpHash,
          expires_at: new Date(session.expiresAt).toISOString(),
          attempts: session.attempts,
          max_attempts: session.maxAttempts,
          resend_count: session.resendCount,
          last_sent_at: new Date(session.lastSentAt).toISOString(),
          verified: session.verified,
          verified_at: session.verifiedAt ? new Date(session.verifiedAt).toISOString() : null,
        },
        { onConflict: "session_id" }
      );
    } catch {
      // Non-fatal, memory cache handles it
    }
  }
}
