import { Resend } from "resend";

// Lazy-initialized Resend client. The instance is rebuilt whenever the
// configured API key changes so a server that booted before the key was
// set (or with a placeholder) never keeps sending through a stale client.
let resendInstance: Resend | null = null;
let resendInstanceKey: string | null = null;

function getResend(apiKey: string): Resend {
  if (!resendInstance || resendInstanceKey !== apiKey) {
    resendInstance = new Resend(apiKey);
    resendInstanceKey = apiKey;
  }
  return resendInstance;
}

export interface EmailPayload {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

export class EmailProvider {
  /**
   * Sends an email using the Resend API.
   * @param payload The email payload (to, subject, html, etc.)
   * @returns `{ id }` with the provider message ID on success, or
   *          `{ error }` when the provider rejected the send. A simulated
   *          `sim_…` id is returned ONLY when no API key is configured at
   *          all (local-dev mode); a configured-but-failing provider is
   *          always surfaced as an error so callers never record a send
   *          that did not happen.
   */
  static async send(
    payload: EmailPayload
  ): Promise<{ id?: string; error?: any }> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey || apiKey === "re_dummy_key" || apiKey.trim() === "") {
      console.warn("[EmailProvider] No valid RESEND_API_KEY configured. Simulating email dispatch.");
      return { id: `sim_${Date.now()}_${Math.random().toString(36).substring(7)}` };
    }

    try {
      const defaultFrom =
        process.env.EMAIL_FROM ||
        process.env.NEXT_PUBLIC_EMAIL_FROM ||
        "Anchor Fashion <onboarding@resend.dev>";

      const resend = getResend(apiKey);
      const response = await resend.emails.send({
        from: payload.from || defaultFrom,
        to: Array.isArray(payload.to) ? payload.to : [payload.to],
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
      });

      if (response.error) {
        console.error("EmailProvider error:", response.error);
        return {
          error:
            (response.error as any)?.message ||
            JSON.stringify(response.error),
        };
      }

      return { id: response.data?.id };
    } catch (error: any) {
      console.error("EmailProvider fatal error:", error);
      return { error: error?.message || String(error) };
    }
  }
}
