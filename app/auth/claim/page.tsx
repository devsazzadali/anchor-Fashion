import { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { ClaimForm } from "@/features/auth/components/claim-form";

export const metadata: Metadata = {
  title: "Claim Your Account | Anchor Fashion",
  description:
    "Set a password to turn your guest orders into a full Anchor Fashion account.",
};

export default async function ClaimAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ phone?: string }>;
}) {
  const { phone } = await searchParams;

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
          Claim Your Account
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Ordered as a guest? Verify your mobile number and set a password —
          all your orders will appear in your account.
        </p>
      </div>

      {/* Divider */}
      <div className="w-full h-px bg-slate-200 dark:bg-slate-700/60" />

      {/* Form */}
      <div className="w-full">
        <ClaimForm initialPhone={phone || ""} />
      </div>

      {/* Login link */}
      <p className="text-center text-sm text-slate-500 dark:text-slate-400">
        Already claimed your account?{" "}
        <Link
          href="/auth/login"
          prefetch={false}
          className="font-semibold text-[#C9A86A] hover:text-[#b09156] hover:underline underline-offset-4 transition-colors"
        >
          Sign In
        </Link>
      </p>
    </div>
  );
}
