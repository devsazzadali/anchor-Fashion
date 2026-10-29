import { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { LoginForm } from "@/features/auth/components/login-form";
import { PhoneLoginForm } from "@/features/auth/components/phone-login-form";

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

      {/* Form */}
      <div className="w-full">
        <LoginForm />
      </div>

      {/* Phone + OTP login (Workstream F) */}
      <div className="flex w-full items-center gap-3">
        <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700/60" />
        <span className="text-xs uppercase tracking-wider text-slate-400">
          অথবা মোবাইল নম্বর দিয়ে
        </span>
        <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700/60" />
      </div>
      <div className="w-full">
        <PhoneLoginForm />
      </div>

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

      {/* Claim link (Phase 12): guest orders created an unclaimed profile
          keyed by phone — its owner can set a password and take it over. */}
      <p className="text-center text-sm text-slate-500 dark:text-slate-400">
        Guest হিসেবে অর্ডার করেছেন?{" "}
        <Link
          href="/auth/claim"
          prefetch={false}
          className="font-semibold text-[#C9A86A] hover:text-[#b09156] hover:underline underline-offset-4 transition-colors"
        >
          Password সেট করে অ্যাকাউন্টটি নিজের করুন
        </Link>
      </p>
    </div>
  );
}

