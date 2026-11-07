import { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { Suspense } from "react";
import { RegisterForm } from "@/features/auth/components/register-form";
import { ReferralCapture } from "./referral-capture";

export const metadata: Metadata = {
  title: "Create an account | Anchor Fashion",
  description: "Join Anchor Fashion to manage your orders, wishlist, and more.",
};

export default function RegisterPage() {
  return (
    <div className="flex flex-col items-center gap-6">
      <Suspense fallback={null}>
        <ReferralCapture />
      </Suspense>

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
          Create an Account
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Join Anchor Fashion to manage your orders, wishlist, and more.
        </p>
      </div>

      {/* Divider */}
      <div className="w-full h-px bg-slate-200 dark:bg-slate-700/60" />

      {/* Form */}
      <div className="w-full">
        <RegisterForm />
      </div>

      <p className="text-center text-sm text-slate-500 dark:text-slate-400">
        Already have an account?{" "}
        <Link
          href="/auth/login"
          prefetch={false}
          className="font-semibold text-[#C9A86A] hover:text-[#b09156] hover:underline underline-offset-4 transition-colors"
        >
          Sign In
        </Link>
      </p>

      <p className="max-w-sm text-center text-xs text-slate-400 dark:text-slate-500">
        By clicking continue, you agree to our{" "}
        <Link href="/terms" className="underline underline-offset-4 hover:text-[#C9A86A] transition-colors">
          Terms of Service
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="underline underline-offset-4 hover:text-[#C9A86A] transition-colors">
          Privacy Policy
        </Link>
        .
      </p>
    </div>
  );
}
