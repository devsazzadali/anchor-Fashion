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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingButton } from "@/components/ui/loading-button";
import { getPostLoginRedirectAction } from "@/actions/auth.actions";

function toE164(raw: string): string | null {
  const cleaned = raw.trim().replace(/[\s\-()]/g, "");
  if (/^01[3-9]\d{8}$/.test(cleaned)) return `+88${cleaned}`;
  if (/^8801[3-9]\d{8}$/.test(cleaned)) return `+${cleaned}`;
  if (/^\+8801[3-9]\d{8}$/.test(cleaned)) return cleaned;
  return null;
}

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
      toast.error("সঠিক মোবাইল নম্বর দিন (01XXXXXXXXX)");
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
          body?.message || "OTP পাঠানো যায়নি — কিছুক্ষণ পরে আবার চেষ্টা করুন"
        );
      }
      setE164(normalized);
      setStep("code");
      toast.success("আপনার মোবাইলে একটি কোড পাঠানো হয়েছে");
    } catch (err: any) {
      toast.error(err.message || "OTP পাঠানো যায়নি");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{4,8}$/.test(code.trim())) {
      toast.error("SMS-এ পাওয়া কোডটি দিন");
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
        throw new Error(body?.message || "কোডটি সঠিক নয় বা মেয়াদ শেষ হয়েছে");
      }
      toast.success("স্বাগতম! লগইন সফল হয়েছে");
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
      toast.error(err.message || "যাচাই করা যায়নি");
      setIsLoading(false);
    }
  }

  if (step === "phone") {
    return (
      <form onSubmit={handleSendOtp} className="w-full space-y-4">
        <div className="space-y-2">
          <Label htmlFor="phone-login-number">মোবাইল নম্বর</Label>
          <Input
            id="phone-login-number"
            inputMode="tel"
            autoComplete="tel"
            placeholder="01XXXXXXXXX"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            এই নম্বরে SMS-এ একটি একবারের লগইন কোড পাঠানো হবে।
          </p>
        </div>
        <LoadingButton type="submit" className="w-full" isLoading={isLoading}>
          SMS কোড পাঠান
        </LoadingButton>
      </form>
    );
  }

  return (
    <form onSubmit={handleVerify} className="w-full space-y-4">
      <div className="space-y-2">
        <Label htmlFor="phone-login-code">SMS কোড</Label>
        <Input
          id="phone-login-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="••••••"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          maxLength={8}
        />
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {e164} নম্বরে পাঠানো কোডটি দিন। কোডের মেয়াদ ৫ মিনিট।
        </p>
      </div>
      <LoadingButton type="submit" className="w-full" isLoading={isLoading}>
        কোড যাচাই করে লগইন করুন
      </LoadingButton>
      <button
        type="button"
        className="w-full text-center text-sm text-slate-500 underline-offset-4 hover:underline dark:text-slate-400"
        onClick={() => {
          setStep("phone");
          setCode("");
        }}
      >
        নম্বর পরিবর্তন করুন
      </button>
    </form>
  );
}
