"use server";

import { getServerSession, resolveUserRole } from "@/lib/auth/server";
import { ADMIN_ROLES, STAFF_ROLES } from "@/lib/constants/auth";
import {
  recordAuditForSessionUser,
  AUDIT_ACTIONS,
} from "@/lib/security/audit";

/**
 * REG-27: sign-in audit writer. Sign-in itself happens client-side
 * against Neon Auth (authClient.signIn.email), so there is no server
 * handler for the event; the login form calls this action immediately
 * after a successful sign-in, while the fresh session cookie is
 * already set. The actor is resolved from that session — the row is
 * written for the user who just signed in, never "System".
 * Fire-and-forget by design: auditing must not block the login flow.
 */
export async function recordSignInAuditAction(): Promise<void> {
  await recordAuditForSessionUser({
    action: AUDIT_ACTIONS.USER_SIGNED_IN,
    entity: "user",
  });
}

export async function getPostLoginRedirectAction(
  nextUrl?: string | null,
  clientUser?: any
): Promise<{ redirectUrl: string; role: string }> {
  try {
    // Fast path 1: if clientUser already has an elevated role, avoid any DB query!
    let role = clientUser?.role ? String(clientUser.role).toUpperCase().trim() : "";

    if (role && role !== "USER" && role !== "CUSTOMER") {
      if (ADMIN_ROLES.includes(role)) {
        if (nextUrl && (nextUrl.startsWith("/admin") || nextUrl.startsWith("/manager"))) {
          return { redirectUrl: nextUrl, role };
        }
        return { redirectUrl: "/admin", role };
      }
      if (STAFF_ROLES.includes(role)) {
        if (nextUrl && nextUrl.startsWith("/manager")) {
          return { redirectUrl: nextUrl, role };
        }
        return { redirectUrl: "/manager", role };
      }
    }

    // Fast path 2: Use clientUser directly if provided to avoid another remote getSession HTTP call
    const user = clientUser || (await getServerSession()).user;

    if (!user) {
      return {
        redirectUrl: nextUrl && !nextUrl.startsWith("/auth/") ? nextUrl : "/account/profile",
        role: "CUSTOMER",
      };
    }

    const resolvedRole = await resolveUserRole(user);

    const isSuperOrAdmin = ADMIN_ROLES.includes(resolvedRole);
    if (isSuperOrAdmin) {
      if (nextUrl && (nextUrl.startsWith("/admin") || nextUrl.startsWith("/manager"))) {
        return { redirectUrl: nextUrl, role: resolvedRole };
      }
      return { redirectUrl: "/admin", role: resolvedRole };
    }

    const isStaffOrAdmin = STAFF_ROLES.includes(resolvedRole);
    if (isStaffOrAdmin) {
      if (nextUrl && nextUrl.startsWith("/manager")) {
        return { redirectUrl: nextUrl, role: resolvedRole };
      }
      return { redirectUrl: "/manager", role: resolvedRole };
    }

    // Customer
    if (nextUrl && !nextUrl.startsWith("/admin") && !nextUrl.startsWith("/auth/")) {
      return { redirectUrl: nextUrl, role: resolvedRole };
    }

    return { redirectUrl: "/account/profile", role: resolvedRole };
  } catch (error) {
    console.error("[getPostLoginRedirectAction] Error:", error);
    return {
      redirectUrl: nextUrl || "/account/profile",
      role: "CUSTOMER",
    };
  }
}
