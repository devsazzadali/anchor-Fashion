import { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { KeyRound } from "lucide-react";
import { LoginTabs } from "@/features/auth/components/login-tabs";

export const metadata: Metadata = {
  title: "Sign In | Anchor Fashion",
  description: "Sign in to your Anchor Fashion account.",
};

export default function LoginPage() {
  return (
    <div className="flex flex-col items-center gap-6">
      {/* Logo */}
      <Link href="/" aria-label="Go to homepage">
        <Image
          src="/logo.png"
          alt="Anchor Fashion"
          width={180}
          height={10}
          style={{ width: "auto", height: "auto" }}
          className="max-w-[160px]"
          priority
        />
      </Link>

      {/* Heading */}
      <div className="text-center space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Welcome back 👋
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Sign in to your account to continue
        </p>
      </div>

      {/* Divider */}
      <div className="w-full h-px bg-slate-200 dark:bg-slate-700/60" />

      {/* Sign-in forms — one method at a time (Email / Mobile Number) */}
      <LoginTabs />

      {/* Register link */}
      <p className="text-center text-sm text-slate-500 dark:text-slate-400">
        Don&apos;t have an account?{" "}
        <Link
          href="/auth/register"
          prefetch={false}
          className="font-semibold text-[#C9A86A] hover:text-[#b09156] hover:underline underline-offset-4 transition-colors"
        >
          Create Account
        </Link>
      </p>

      {/* Claim box (Phase 12): guest orders created an unclaimed profile
          keyed by phone — its owner can set a password and take it over. */}
      <div className="flex w-full items-start gap-3 rounded-xl border border-[#C9A86A]/40 bg-[#C9A86A]/5 px-4 py-3.5 dark:bg-[#C9A86A]/10">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#C9A86A]/15 text-[#C9A86A]">
          <KeyRound className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="space-y-1">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Ordered as a guest?
          </p>
          <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            Verify your mobile number and set a password — all your orders
            will then appear in your account.
          </p>
          <Link
            href="/auth/claim"
            prefetch={false}
            className="inline-block pt-0.5 text-sm font-semibold text-[#C9A86A] underline-offset-4 transition-colors hover:text-[#b09156] hover:underline"
          >
            Set Password →
          </Link>
        </div>
      </div>
    </div>
  );
}
