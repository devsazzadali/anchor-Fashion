/**
 * Authentication surface (lib/db).
 *
 * Delegates to the project's Neon Auth integration (lib/auth) for session
 * operations and to Prisma (lib/prisma) for profile-backed admin user
 * management. Returned user objects carry the metadata shape the app's
 * call sites consume (user_metadata / app_metadata with role).
 */
import prisma from "@/lib/prisma";

export const dbAuth = {
  getUser: async (_token?: string) => {
    try {
      if (typeof window !== "undefined") {
        const { authClient } = await import("@/lib/auth/client");
        const res = await authClient.getSession();
        const u = res?.data?.user;
        if (u) {
          return {
            data: {
              user: {
                ...u,
                id: u.id,
                email: u.email,
                user_metadata: {
                  first_name: u.name?.split(" ")[0] || "",
                  last_name: u.name?.split(" ").slice(1).join(" ") || "",
                  full_name: u.name || "",
                  role: (u as any).role || "CUSTOMER",
                },
                app_metadata: {
                  role: (u as any).role || "CUSTOMER",
                },
              },
            },
            error: null,
          };
        }
        return { data: { user: null }, error: null };
      } else {
        const { getServerSession } = await import("@/lib/auth/server");
        const { user: u } = await getServerSession();
        if (u) {
          // getServerSession() already resolved the role through the guarded
          // resolveUserRole (identity-bound / verified-email only). Do not re-query
          // the profile by email here.
          const resolvedRole = (u as any).role;
          const finalRole = resolvedRole || "CUSTOMER";
          return {
            data: {
              user: {
                ...u,
                id: u.id,
                email: u.email,
                user_metadata: {
                  first_name: u.name?.split(" ")[0] || "",
                  last_name: u.name?.split(" ").slice(1).join(" ") || "",
                  full_name: u.name || "",
                  role: finalRole,
                },
                app_metadata: {
                  role: finalRole,
                },
              },
            },
            error: null,
          };
        }
        return { data: { user: null }, error: null };
      }
    } catch {
      return { data: { user: null }, error: null };
    }
  },
  getSession: async () => {
    try {
      if (typeof window !== "undefined") {
        const { authClient } = await import("@/lib/auth/client");
        const res = await authClient.getSession();
        return {
          data: { session: res?.data?.session || null },
          error: null,
        };
      } else {
        const { getServerSession } = await import("@/lib/auth/server");
        const { session } = await getServerSession();
        return { data: { session: session || null }, error: null };
      }
    } catch {
      return { data: { session: null }, error: null };
    }
  },
  signOut: async () => {
    try {
      if (typeof window !== "undefined") {
        const { authClient } = await import("@/lib/auth/client");
        await authClient.signOut();
      }
    } catch {}
    return { error: null };
  },
  updateUser: async (updates: any) => {
    try {
      if (typeof window === "undefined") {
        const { getServerSession } = await import("@/lib/auth/server");
        const { user } = await getServerSession();
        if (user?.id) {
          const meta = updates?.data || updates?.user_metadata || {};
          await prisma.profile.update({
            where: { id: user.id },
            data: {
              firstName: meta.first_name !== undefined ? meta.first_name : undefined,
              lastName: meta.last_name !== undefined ? meta.last_name : undefined,
              phone: updates.phone !== undefined ? updates.phone : undefined,
            },
          });
        }
      }
      return { data: { user: updates }, error: null };
    } catch (e: any) {
      return { data: null, error: { message: e.message } };
    }
  },
  resetPasswordForEmail: async (email: string, opts?: any) => {
    return { data: {}, error: null };
  },
  onAuthStateChange: (cb: any) => {
    return { data: { subscription: { unsubscribe: () => {} } } };
  },
  exchangeCodeForSession: async () => ({
    data: { session: null, user: null },
    error: null,
  }),
  admin: {
    getUserById: async (id: string) => {
      try {
        const isUuid =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            id
          );
        if (!isUuid) return { data: { user: null }, error: null };

        const p = await prisma.profile.findUnique({
          where: { id },
          include: { role: true },
        });
        if (!p) return { data: { user: null }, error: null };
        return {
          data: {
            user: {
              id: p.id,
              email: p.email,
              user_metadata: {
                first_name: p.firstName || "",
                last_name: p.lastName || "",
                full_name: `${p.firstName || ""} ${p.lastName || ""}`.trim(),
                role: p.role?.name || "CUSTOMER",
              },
              app_metadata: {
                role: p.role?.name || "CUSTOMER",
              },
            },
          },
          error: null,
        };
      } catch {
        return { data: { user: null }, error: null };
      }
    },
    listUsers: async () => {
      try {
        const profiles = await prisma.profile.findMany({
          include: { role: true },
        });
        const users = profiles.map((p) => ({
          id: p.id,
          email: p.email,
          created_at: p.createdAt?.toISOString(),
          user_metadata: {
            first_name: p.firstName || "",
            last_name: p.lastName || "",
            full_name: `${p.firstName || ""} ${p.lastName || ""}`.trim(),
            role: p.role?.name || "CUSTOMER",
          },
          app_metadata: {
            role: p.role?.name || "CUSTOMER",
          },
        }));
        return { data: { users }, error: null };
      } catch {
        return { data: { users: [] }, error: null };
      }
    },
    deleteUser: async (id: string) => {
      try {
        await prisma.profile.delete({ where: { id } });
        return { data: null, error: null };
      } catch (e: any) {
        return { data: null, error: { message: e.message } };
      }
    },
    createUser: async (
      userData: any
    ): Promise<{ data: { user: any }; error: { message: string } | null }> => {
      try {
        // 1. Synchronize credentials with Neon Auth if password provided
        if (userData.password) {
          try {
            const baseUrl = process.env.NEON_AUTH_BASE_URL;
            if (!baseUrl) {
              throw new Error("NEON_AUTH_BASE_URL is not configured");
            }
            const fullName = `${
              userData.user_metadata?.first_name ||
              userData.first_name ||
              ""
            } ${
              userData.user_metadata?.last_name ||
              userData.last_name ||
              ""
            }`.trim();
            await fetch(`${baseUrl}/sign-up/email`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email: userData.email,
                password: userData.password,
                name: fullName || userData.email?.split("@")[0],
              }),
            });
          } catch (neonAuthErr) {
            console.warn(
              "[polyfill.createUser] Neon Auth sync note:",
              neonAuthErr
            );
          }
        }

        // 2. Resolve Role ID if role name provided
        const roleName = userData.user_metadata?.role || userData.role;
        let roleId = userData.role_id || userData.roleId;
        if (!roleId && roleName) {
          const roleRecord = await prisma.role.findFirst({
            where: { name: { equals: roleName, mode: "insensitive" } },
          });
          if (roleRecord) roleId = roleRecord.id;
        }

        // 3. Upsert profile in Neon DB
        const existing = await prisma.profile.findFirst({
          where: { email: userData.email },
        });

        let p;
        if (existing) {
          p = await prisma.profile.update({
            where: { id: existing.id },
            data: {
              firstName:
                userData.user_metadata?.first_name ||
                userData.first_name ||
                existing.firstName,
              lastName:
                userData.user_metadata?.last_name ||
                userData.last_name ||
                existing.lastName,
              phone: userData.phone || existing.phone,
              roleId: roleId || existing.roleId,
              isActive: true,
            },
          });
        } else {
          p = await prisma.profile.create({
            data: {
              email: userData.email,
              firstName:
                userData.user_metadata?.first_name ||
                userData.first_name ||
                null,
              lastName:
                userData.user_metadata?.last_name ||
                userData.last_name ||
                null,
              phone: userData.phone || null,
              roleId: roleId || null,
              isActive: true,
            },
          });
        }

        return {
          data: { user: { id: p.id, email: p.email } },
          error: null,
        };
      } catch (e: any) {
        return {
          data: {
            user: {
              id: userData?.id || "user-" + Date.now(),
              email: userData?.email,
            },
          },
          error: { message: e?.message || "Failed to create user" },
        };
      }
    },
    updateUserById: async (
      id: string,
      updates: any
    ): Promise<{ data: { user: any }; error: { message: string } | null }> => {
      try {
        const meta = updates.user_metadata || {};
        const isUuid =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            id
          );
        if (isUuid) {
          let roleId = updates.role_id || updates.roleId;
          const roleName = meta.role || updates.role;
          if (!roleId && roleName) {
            const roleRecord = await prisma.role.findFirst({
              where: { name: { equals: roleName, mode: "insensitive" } },
            });
            if (roleRecord) roleId = roleRecord.id;
          }

          await prisma.profile.update({
            where: { id },
            data: {
              firstName:
                meta.first_name !== undefined ? meta.first_name : undefined,
              lastName:
                meta.last_name !== undefined ? meta.last_name : undefined,
              phone: updates.phone !== undefined ? updates.phone : undefined,
              roleId: roleId !== undefined ? roleId : undefined,
            },
          });
        }
        return { data: { user: { id, ...updates } }, error: null };
      } catch (e: any) {
        return {
          data: { user: { id, ...updates } },
          error: { message: e?.message || "Failed to update user" },
        };
      }
    },
  },
};
