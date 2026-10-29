"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import {
  requestClaimOtpAction,
  verifyClaimOtpAction,
  completeClaimAction,
} from "@/app/actions/auth/claim.actions";

type Step = "phone" | "otp" | "password" | "done";

export function ClaimForm({ initialPhone = "" }: { initialPhone?: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("phone");
  const [isLoading, setIsLoading] = useState(false);

  const [phone, setPhone] = useState(initialPhone);
  const [sessionId, setSessionId] = useState("");
  const [maskedTarget, setMaskedTarget] = useState("");
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [needsEmail, setNeedsEmail] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [claimedEmail, setClaimedEmail] = useState("");

  async function onSendCode(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    const res: any = await requestClaimOtpAction(phone.trim());
    setIsLoading(false);
    if (!res?.success) {
      toast.error(res?.error || "Could not send the verification code.");
      return;
    }
    setSessionId(res.sessionId);
    setMaskedTarget(res.maskedTarget || "");
    setStep("otp");
    toast.success("Verification code sent by SMS.");
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    const res: any = await verifyClaimOtpAction(sessionId, code.trim());
    setIsLoading(false);
    if (!res?.success) {
      toast.error(res?.error || "Invalid verification code.");
      return;
    }
    setStep("password");
  }

  async function onComplete(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords don't match");
      return;
    }
    setIsLoading(true);
    const res: any = await completeClaimAction(
      sessionId,
      password,
      needsEmail ? email.trim() : null
    );
    setIsLoading(false);
    if (!res?.success) {
      if (res?.code === "email_required") {
        setNeedsEmail(true);
        toast.error("Please add an email address for your login.");
        return;
      }
      toast.error(res?.error || "Could not complete the claim.");
      return;
    }
    setClaimedEmail(res.email || "");
    setStep("done");
    toast.success("Account claimed! You can now sign in.");
  }

  if (step === "done") {
    return (
      <div className="w-full space-y-5 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Your account is ready!
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Sign in with <span className="font-medium text-slate-700 dark:text-slate-200">{claimedEmail}</span> and
            the password you just set to see all your orders.
          </p>
        </div>
        <Button
          type="button"
          className="w-full h-12 bg-[#C9A86A] hover:bg-[#b09156] text-white shadow-md transition-all rounded-lg font-semibold"
          onClick={() => router.push("/auth/login")}
        >
          Go to Sign In
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full">
      {step === "phone" && (
        <form onSubmit={onSendCode} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="claim-phone" className="text-slate-800 dark:text-slate-200 font-semibold text-sm">
              Mobile Number (used on your order)
            </Label>
            <Input
              id="claim-phone"
              type="tel"
              inputMode="tel"
              placeholder="01XXXXXXXXX (11 digits)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={isLoading}
              className="h-12 bg-slate-50/70 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700"
              required
            />
            <p className="text-xs text-slate-400">
              Enter the 11-digit mobile number you used when placing your
              order. We will SMS a 6-digit verification code to it.
            </p>
          </div>
          <Button
            type="submit"
            className="w-full h-12 bg-[#C9A86A] hover:bg-[#b09156] text-white shadow-md transition-all rounded-lg font-semibold"
            disabled={isLoading}
          >
            {isLoading ? "Please wait..." : "Send Verification Code"}
          </Button>
        </form>
      )}

      {step === "otp" && (
        <form onSubmit={onVerify} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="claim-code" className="text-slate-800 dark:text-slate-200 font-semibold text-sm">
              Verification Code
            </Label>
            <Input
              id="claim-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6-digit code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              disabled={isLoading}
              className="h-12 text-center tracking-[0.5em] font-mono text-lg bg-slate-50/70 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700"
              required
            />
            <p className="text-xs text-slate-400">
              Code sent to {maskedTarget || "your mobile"}. It expires in 5 minutes.
            </p>
          </div>
          <Button
            type="submit"
            className="w-full h-12 bg-[#C9A86A] hover:bg-[#b09156] text-white shadow-md transition-all rounded-lg font-semibold"
            disabled={isLoading}
          >
            {isLoading ? "Please wait..." : "Verify Code"}
          </Button>
          <button
            type="button"
            className="w-full text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline-offset-4 hover:underline"
            onClick={() => {
              setStep("phone");
              setCode("");
            }}
            disabled={isLoading}
          >
            Use a different number
          </button>
        </form>
      )}

      {step === "password" && (
        <form onSubmit={onComplete} className="space-y-5">
          {needsEmail && (
            <div className="space-y-2">
              <Label htmlFor="claim-email" className="text-slate-800 dark:text-slate-200 font-semibold text-sm">
                Email (for sign-in)
              </Label>
              <Input
                id="claim-email"
                type="email"
                placeholder="Enter your email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
                className="h-12 bg-slate-50/70 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700"
                required
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="claim-password" className="text-slate-800 dark:text-slate-200 font-semibold text-sm">
              New Password
            </Label>
            <PasswordInput
              id="claim-password"
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              className="h-12 bg-slate-50/70 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="claim-confirm" className="text-slate-800 dark:text-slate-200 font-semibold text-sm">
              Confirm Password
            </Label>
            <PasswordInput
              id="claim-confirm"
              placeholder="••••••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={isLoading}
              className="h-12 bg-slate-50/70 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700"
              required
            />
          </div>
          <Button
            type="submit"
            className="w-full h-12 bg-[#C9A86A] hover:bg-[#b09156] text-white shadow-md transition-all rounded-lg font-semibold"
            disabled={isLoading}
          >
            {isLoading ? "Please wait..." : "Set Password & Claim Account"}
          </Button>
        </form>
      )}
    </div>
  );
}
