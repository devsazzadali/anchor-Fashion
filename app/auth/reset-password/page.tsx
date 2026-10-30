import { Metadata } from "next";
import { AnchorFashionLogo } from "@/components/shared/logo";
import { ResetPasswordForm } from "@/features/auth/components/reset-password-form";

export const metadata: Metadata = {
  title: "Reset Password",
  description: "Enter your new password",
};

export default function ResetPasswordPage() {
  return (
    <div className="flex flex-col items-center gap-6">
      {/* Logo — the shared animated brand mark, same as the storefront header */}
      <AnchorFashionLogo className="w-[160px]" />

      {/* Heading */}
      <div className="text-center space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Reset Password
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Enter your new password below.
        </p>
      </div>

      {/* Divider */}
      <div className="w-full h-px bg-slate-200 dark:bg-slate-700/60" />

      {/* Form */}
      <div className="w-full">
        <ResetPasswordForm />
      </div>
    </div>
  );
}
