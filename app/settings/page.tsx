import { createDbClient } from "@/lib/db/client";
import { redirect } from "next/navigation";
import { ADMIN_ROLES, MANAGER_ROLES, MARKETING_ROLES } from "@/lib/constants/auth";

export const dynamic = "force-dynamic";

export default async function SettingsRedirectPage() {
  const db = await createDbClient();
  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    redirect("/auth/login?next=/settings");
  }

  let role = user.user_metadata?.role || user.app_metadata?.role;
  if (!role) {
    try {
      const { data: profile } = await db
        .from("profiles")
        .select("roles(name)")
        .eq("id", user.id)
        .single();
      role = (profile?.roles as any)?.name;
    } catch {
      role = "CUSTOMER";
    }
  }

  // Canonical role names are UPPERCASE; normalize before allow-list checks.
  role = String(role || "").toUpperCase().trim();

  if (ADMIN_ROLES.includes(role)) {
    redirect("/admin/settings");
  } else if (MANAGER_ROLES.includes(role)) {
    redirect("/manager/settings");
  } else if (MARKETING_ROLES.includes(role)) {
    redirect("/admin/profile");
  } else {
    redirect("/account/security");
  }
}
