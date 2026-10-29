"use server";

import { createDbClient } from "@/lib/db/client";

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

/**
 * Subscribe an email to the newsletter list (newsletter_subscribers).
 * Idempotent: re-subscribing an active address is a no-op success, and an
 * inactive address is reactivated. This replaces a storefront form that
 * previously only simulated a subscription in the browser.
 */
export async function subscribeNewsletterAction(email: string): Promise<{
  success: boolean;
  alreadySubscribed?: boolean;
  error?: string;
}> {
  try {
    const normalized = (email || "").trim().toLowerCase();
    if (!EMAIL_REGEX.test(normalized) || normalized.length > 255) {
      return { success: false, error: "Please enter a valid email address." };
    }

    const db = await createDbClient();

    const { data: existing } = await db
      .from("newsletter_subscribers")
      .select("id, is_active")
      .eq("email", normalized)
      .maybeSingle();

    if (existing) {
      if ((existing as any).is_active) {
        return { success: true, alreadySubscribed: true };
      }
      const { error } = await db
        .from("newsletter_subscribers")
        .update({ is_active: true })
        .eq("id", (existing as any).id);
      if (error) throw error;
      return { success: true };
    }

    const { error } = await db
      .from("newsletter_subscribers")
      .insert({ email: normalized, is_active: true });
    if (error) throw error;

    return { success: true };
  } catch (error: any) {
    console.error("[subscribeNewsletterAction]", error);
    return {
      success: false,
      error: "Could not complete your subscription. Please try again.",
    };
  }
}
