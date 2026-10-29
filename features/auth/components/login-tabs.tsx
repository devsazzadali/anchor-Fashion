"use client";

/**
 * Sign-in method switcher (auth UX redesign).
 *
 * Shows ONE login method at a time — Email (default) or mobile-number OTP —
 * instead of stacking both full forms on the page. Switching is instant and
 * client-side; each form keeps its existing flow, endpoints and behaviour.
 */
import { useState } from "react";
import { Mail, Smartphone } from "lucide-react";
import { LoginForm } from "@/features/auth/components/login-form";
import { PhoneLoginForm } from "@/features/auth/components/phone-login-form";

type Method = "email" | "phone";

const TAB_BASE =
  "flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all";
const TAB_ACTIVE =
  "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-700";
const TAB_INACTIVE =
  "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100";

export function LoginTabs() {
  const [method, setMethod] = useState<Method>("email");

  return (
    <div className="w-full">
      {/* Method switcher */}
      <div
        role="tablist"
        aria-label="Sign-in method"
        className="grid w-full grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800"
      >
        <button
          type="button"
          role="tab"
          aria-selected={method === "email"}
          onClick={() => setMethod("email")}
          className={`${TAB_BASE} ${method === "email" ? TAB_ACTIVE : TAB_INACTIVE}`}
        >
          <Mail className="h-4 w-4 text-[#C9A86A]" aria-hidden="true" />
          Email
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={method === "phone"}
          onClick={() => setMethod("phone")}
          className={`${TAB_BASE} ${method === "phone" ? TAB_ACTIVE : TAB_INACTIVE}`}
        >
          <Smartphone className="h-4 w-4 text-[#C9A86A]" aria-hidden="true" />
          Mobile Number
        </button>
      </div>

      {/* Active form only */}
      <div className="mt-6">
        {method === "email" ? <LoginForm /> : <PhoneLoginForm />}
      </div>
    </div>
  );
}
