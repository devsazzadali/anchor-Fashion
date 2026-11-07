/**
 * Account claiming (Phase 12 — hybrid checkout).
 *
 * A guest's orders silently create an UNCLAIMED customer profile keyed by
 * phone (see guest-profile.service.ts). Claiming lets the phone's owner take
 * that profile over as a real login:
 *
 *   1. enter the order phone → OTP by SMS (PhoneOtpService; HMAC-hashed,
 *      5-minute expiry, attempt + resend caps),
 *   2. verify the OTP → proof of phone ownership,
 *   3. set a password → a Neon Auth user is created for the profile's email
 *      (the codebase's established server-side sign-up pattern), and the
 *      profile is REBOUND to that auth user (profiles.id := auth user id —
 *      every FK referencing profiles is ON UPDATE CASCADE, so orders,
 *      addresses, reviews all follow) and stamped claimed_at.
 *
 * Until this flow completes, the profile has NO credentials and cannot be
 * logged into — there is no default password, ever.
 */
import { prisma } from "@/lib/prisma";
import { CodOtpService } from "@/lib/services/fraud/cod-otp.service";
import {
  findProfileByNormalizedPhone,
  normalizePhone,
} from "@/lib/services/customer/guest-profile.service";
import { PhoneOtpService } from "./phone-otp.service";

/** A verified OTP stays usable for completing the claim this long. */
const VERIFIED_WINDOW_MS = 10 * 60 * 1000;

export type ClaimRequestResult =
  | { success: true; sessionId: string; maskedTarget: string }
  | { success: false; error: string; remainingCooldownSeconds?: number };

export class AccountClaimService {
  /**
   * Step 1 — request the claim OTP. The response shape is identical whether
   * or not an unclaimed profile exists for the number (no enumeration); the
   * SMS is only dispatched when there is something to claim.
   */
  static async requestOtp(rawPhone: string): Promise<ClaimRequestResult> {
    const normalized = normalizePhone(rawPhone);
    if (!normalized) {
      return { success: false, error: "Please enter a valid Bangladeshi mobile number." };
    }
    const maskedTarget = CodOtpService.maskTarget(normalized, "phone");

    const profile = await findProfileByNormalizedPhone(normalized).catch(
      () => null
    );

    if (!profile || profile.claimedAt) {
      // Nothing claimable — return the same shape, send nothing.
      return {
        success: true,
        sessionId: PhoneOtpService.newSessionId("claim"),
        maskedTarget,
      };
    }

    const sessionId = `claim_${profile.id}`;
    const res = await PhoneOtpService.initiate({ sessionId, phone: normalized });
    if (!res.success) {
      return {
        success: false,
        error: res.error || "Could not send the verification code.",
        remainingCooldownSeconds: res.remainingCooldownSeconds,
      };
    }
    return { success: true, sessionId, maskedTarget };
  }

  /** Step 2 — verify the OTP for a claim session. */
  static async verifyOtp(sessionId: string, code: string) {
    if (!sessionId || !code || code.trim().length !== 6) {
      return { success: false, error: "Please enter the 6-digit verification code." };
    }
    return PhoneOtpService.verify(sessionId, code.trim());
  }

  /**
   * Step 3 — set the password and create the linked Neon Auth user.
   * Requires a session verified within the last 10 minutes.
   */
  static async completeClaim(params: {
    sessionId: string;
    password: string;
    emailOverride?: string | null;
  }): Promise<
    | { success: true; email: string }
    | { success: false; error: string; code?: string }
  > {
    const { sessionId, password } = params;

    if (!password || password.length < 8) {
      return {
        success: false,
        error: "Password must be at least 8 characters.",
      };
    }

    const session = await PhoneOtpService.getSessionRow(sessionId);
    if (!session || !session.verified || session.target_type !== "phone") {
      return {
        success: false,
        error: "Verification session not found or not verified. Please request a new code.",
      };
    }
    const verifiedAt = session.verified_at
      ? new Date(session.verified_at).getTime()
      : 0;
    if (!verifiedAt || Date.now() - verifiedAt > VERIFIED_WINDOW_MS) {
      return {
        success: false,
        error: "Your verification has expired. Please request a new code.",
      };
    }

    const profile = await findProfileByNormalizedPhone(session.target_value);
    if (!profile) {
      return { success: false, error: "No account was found for this number." };
    }
    if (profile.claimedAt) {
      return {
        success: false,
        error: "This account has already been claimed. Please log in instead.",
        code: "already_claimed",
      };
    }

    // Resolve the login email: the profile's email, or one supplied now
    // (checkout always collects an email, so the override is an edge path).
    let email = (profile.email || "").trim().toLowerCase();
    const override = (params.emailOverride || "").trim().toLowerCase();
    if (!email && override) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(override)) {
        return { success: false, error: "Please enter a valid email address." };
      }
      const taken = await prisma.profile.findUnique({
        where: { email: override },
        select: { id: true },
      });
      if (taken) {
        return {
          success: false,
          error: "That email is already used by another account.",
        };
      }
      email = override;
    }
    if (!email) {
      return {
        success: false,
        error: "An email address is required to create the login.",
        code: "email_required",
      };
    }

    // Create the Neon Auth user (same server-side sign-up pattern the
    // codebase already uses in lib/db/auth.ts).
    const baseUrl = process.env.NEON_AUTH_BASE_URL;
    if (!baseUrl) {
      return { success: false, error: "Authentication is not configured." };
    }
    const fullName =
      [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim() ||
      "Customer";

    let authUserId: string | null = null;
    try {
      // Better Auth rejects POST auth calls without an Origin header
      // ("Origin header is required when callbackURL is not an absolute
      // URL") — a browser sends it automatically, this server-side call
      // must set it explicitly to the app's own (trusted) origin.
      const appOrigin = (
        process.env.NEXT_PUBLIC_APP_URL || "https://anchorfashion.com"
      ).replace(/\/+$/, "");
      const res = await fetch(`${baseUrl}/sign-up/email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: appOrigin,
          Referer: `${appOrigin}/auth/claim`,
        },
        body: JSON.stringify({ email, password, name: fullName }),
      });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = String(json?.code || "");
        if (
          code.includes("USER_ALREADY_EXISTS") ||
          /already exists/i.test(String(json?.message || ""))
        ) {
          return {
            success: false,
            error:
              "An account with this email already exists. Please log in with that account — your orders are linked to it.",
            code: "already_registered",
          };
        }
        return {
          success: false,
          error: json?.message || "Could not create the account. Please try again.",
        };
      }
      authUserId = json?.user?.id || json?.data?.user?.id || null;
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || "Could not reach the authentication service.",
      };
    }

    // Bind the profile to the auth user and stamp the claim. When the auth
    // user id is known, rebind profiles.id (all referencing FKs are
    // ON UPDATE CASCADE) so every order/address/review follows; the email
    // binding remains as a fallback either way.
    const now = new Date();
    if (authUserId && authUserId !== profile.id) {
      await prisma.$executeRawUnsafe(
        `UPDATE profiles
            SET id = $1::uuid,
                claimed_at = $2,
                phone_verified_at = COALESCE(phone_verified_at, $2),
                email = COALESCE(email, $3)
          WHERE id = $4::uuid`,
        authUserId,
        now,
        email,
        profile.id
      );
    } else {
      await prisma.profile.update({
        where: { id: profile.id },
        data: {
          claimedAt: now,
          phoneVerifiedAt: profile.phoneVerifiedAt || now,
          email: profile.email || email,
        },
      });
    }

    // The verification must not be replayable.
    await PhoneOtpService.consume(sessionId);

    return { success: true, email };
  }
}
