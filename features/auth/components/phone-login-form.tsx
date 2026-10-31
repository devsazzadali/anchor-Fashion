"use client";

/**
 * Phone + OTP login (Workstream F).
 *
 * Talks to the hosted Neon Auth phone-number plugin through the app's
 * own auth proxy (app/api/auth/[...path]):
 *   POST /api/auth/phone-number/send-otp  { phoneNumber }
 *   POST /api/auth/phone-number/verify    { phoneNumber, code }
 * Neon generates the code and calls our /api/webhooks/neon-auth receiver,
 * which delivers it by SMS (Alpha SMS). Verify sets the session cookie;
 * the post-login redirect mirrors the email login form.
 */
import { useState } from "react";
import { toast } from "sonner";
import { KeyRound, Smartphone } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingButton } from "@/components/ui/loading-button";
import { getPostLoginRedirectAction } from "@/lib/actions/auth.actions";

function toE164(raw: string): string | null {
  const cleaned = raw.trim().replace(/[\s\-()]/g, "");
  if (/^01[3-9]\d{8}$/.test(cleaned)) return `+88${cleaned}`;
  if (/^8801[3-9]\d{8}$/.test(cleaned)) return `+${cleaned}`;
  if (/^\+8801[3-9]\d{8}$/.test(cleaned)) return cleaned;
  return null;
}

const LABEL_CLASS =
  "text-slate-700 dark:text-slate-300 font-medium text-sm";
const INPUT_CLASS =
  "pl-10 h-12 bg-slate-50/70 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus-visible:ring-[#C9A86A]/30 focus-visible:border-[#C9A86A]";
const BUTTON_CLASS =
  "w-full h-12 bg-[#C9A86A] hover:bg-[#b09156] active:bg-[#9d7e47] text-white shadow-md shadow-[#C9A86A]/20 transition-all rounded-lg font-semibold tracking-wide";

export function PhoneLoginForm() {
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [e164, setE164] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    const normalized = toE164(phone);
    if (!normalized) {
      toast.error("Please enter a valid mobile number (01XXXXXXXXX)");
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/phone-number/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: normalized }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body?.message || "Could not send the OTP — please try again in a moment"
        );
      }
      setE164(normalized);
      setStep("code");
      toast.success("A code has been sent to your mobile");
    } catch (err: any) {
      toast.error(err.message || "Could not send the OTP");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{4,8}$/.test(code.trim())) {
      toast.error("Please enter the code from the SMS");
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/phone-number/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: e164, code: code.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.message || "The code is incorrect or has expired");
      }
      toast.success("Welcome! You are signed in");
      try {
        const params = new URLSearchParams(window.location.search);
        const next = params.get("callbackUrl") || params.get("next");
        const { redirectUrl } = await getPostLoginRedirectAction(
          next,
          body?.user
        );
        window.location.replace(redirectUrl);
      } catch {
        window.location.replace("/account/profile");
      }
    } catch (err: any) {
      toast.error(err.message || "Verification failed");
      setIsLoading(false);
    }
  }

  if (step === "phone") {
    return (
      <form onSubmit={handleSendOtp} className="w-full space-y-4">
        <div className="space-y-2">
          <Label htmlFor="phone-login-number" className={LABEL_CLASS}>
            Mobile Number
          </Label>
          <div className="relative">
            <Smartphone
              aria-hidden="true"
              className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#C9A86A]"
            />
            <Input
              id="phone-login-number"
              inputMode="tel"
              autoComplete="tel"
              placeholder="01XXXXXXXXX (11 digits)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={isLoading}
              className={INPUT_CLASS}
            />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Enter your 11-digit mobile number — we will send a one-time login
            code by SMS to this number.
          </p>
        </div>
        <LoadingButton
          type="submit"
          className={BUTTON_CLASS}
          isLoading={isLoading}
        >
          Send SMS Code
        </LoadingButton>
      </form>
    );
  }

  return (
    <form onSubmit={handleVerify} className="w-full space-y-4">
      <div className="space-y-2">
        <Label htmlFor="phone-login-code" className={LABEL_CLASS}>
          SMS Code
        </Label>
        <div className="relative">
          <KeyRound
            aria-hidden="true"
            className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#C9A86A]"
          />
          <Input
            id="phone-login-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="••••••"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            maxLength={8}
            disabled={isLoading}
            className={`${INPUT_CLASS} text-center font-mono text-lg tracking-[0.35em]`}
          />
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Enter the code sent to {e164}. The code expires in 5 minutes.
        </p>
      </div>
      <LoadingButton
        type="submit"
        className={BUTTON_CLASS}
        isLoading={isLoading}
      >
        Verify Code &amp; Sign In
      </LoadingButton>
      <button
        type="button"
        className="w-full text-center text-sm text-slate-500 underline-offset-4 transition-colors hover:text-[#C9A86A] hover:underline dark:text-slate-400"
        onClick={() => {
          setStep("phone");
          setCode("");
        }}
      >
        Change number
      </button>
    </form>
  );
}
