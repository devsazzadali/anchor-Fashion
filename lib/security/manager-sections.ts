import { redirect } from "next/navigation";
import { getServerSession, resolveUserRole } from "@/lib/auth/server";
import { MANAGER_ROLES, MARKETING_ROLES } from "@/lib/constants/auth";

/**
 * S3-3: route-level role granularity inside /manager.
 *
 * The manager sidebar already hides sections per role, but hiding was the
 * ONLY barrier — a SUPPORT login could open manager-only sections by
 * direct URL. These guards mirror the sidebar's exact role groups
 * (components/manager/layout/ManagerSidebar.tsx):
 *   - reports, settings          → MANAGER_ROLES
 *   - marketing, cms             → MANAGER_ROLES ∪ MARKETING_ROLES
 *   - everything else            → all staff (parent layout's gate)
 *
 * Denied requests bounce to the role's home (/manager), following the
 * redirect pattern the parent manager layout already uses.
 */
export const MANAGER_ONLY_ROLES: readonly string[] = MANAGER_ROLES;

export const MANAGER_OR_MARKETING_ROLES: readonly string[] = Array.from(
  new Set([...MANAGER_ROLES, ...MARKETING_ROLES])
);

export async function requireManagerSection(
  allowedRoles: readonly string[],
  nextPath: string
): Promise<{ user: any; role: string }> {
  const { user } = await getServerSession();

  if (!user) {
    redirect(`/auth/login?next=${nextPath}`);
  }

  const role = (user.role || (await resolveUserRole(user)))
    .toUpperCase()
    .trim();

  if (!allowedRoles.includes(role)) {
    redirect("/manager");
  }

  return { user, role };
}
