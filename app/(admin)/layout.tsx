import { redirect } from "next/navigation";
import { getServerSession, resolveUserRole } from "@/lib/auth/server";
import { ADMIN_ROLES, STAFF_ROLES } from "@/lib/constants/auth";

/**
 * Group-level guard for everything under app/(admin).
 *
 * Most pages live under /admin, which has its own layout that repeats
 * this check (nested layouts both run — harmless). But the group also
 * contains stray top-level pages (/customers, /loyalty) that sit OUTSIDE
 * the /admin layout and previously rendered their shells to anyone,
 * signed in or not. This layout closes that gap: it renders no UI of
 * its own, only enforces session + role for the whole group.
 */
export default async function AdminGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();
  const user = session?.user;
  if (!user?.id) {
    redirect("/auth/login");
  }

  const role = await resolveUserRole(user as any);

  if (ADMIN_ROLES.includes(role)) {
    return <>{children}</>;
  }
  if (STAFF_ROLES.includes(role)) {
    redirect("/manager");
  }
  redirect("/account/profile");
}
