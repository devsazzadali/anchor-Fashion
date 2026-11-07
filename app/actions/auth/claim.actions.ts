"use server";

import { AccountClaimService } from "@/lib/services/auth/account-claim.service";

/** Step 1: send the claim OTP SMS to the order phone number. */
export async function requestClaimOtpAction(phone: string) {
  try {
    return await AccountClaimService.requestOtp(phone || "");
  } catch (error: any) {
    return { success: false as const, error: error.message || "Could not send the code." };
  }
}

/** Step 2: verify the entered OTP. */
export async function verifyClaimOtpAction(sessionId: string, code: string) {
  try {
    return await AccountClaimService.verifyOtp(sessionId, code || "");
  } catch (error: any) {
    return { success: false as const, error: error.message || "Verification failed." };
  }
}

/** Step 3: set the password and create the linked login. */
export async function completeClaimAction(
  sessionId: string,
  password: string,
  emailOverride?: string | null
) {
  try {
    return await AccountClaimService.completeClaim({
      sessionId,
      password: password || "",
      emailOverride: emailOverride || null,
    });
  } catch (error: any) {
    return { success: false as const, error: error.message || "Could not complete the claim." };
  }
}
