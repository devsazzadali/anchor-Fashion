/**
 * Authentication surface (lib/db).
 *
 * Delegates to the project's Neon Auth integration (lib/auth) for session
 * operations and to Prisma (lib/prisma) for profile-backed admin user
 * management. Returned user objects carry the metadata shape the app's
 * call sites consume (user_metadata / app_metadata with role).
 */
import prisma from "@/lib/prisma";

/**
 * Sets an EXISTING Neon Auth user's password through the auth layer's own
 * reset-token flow — the supported server-side mechanism for changing an
 * existing credential:
 *   1. POST /request-password-reset — the auth service mints a single-use
 *      token in neon_auth.verification (identifier "reset-password:<token>",
 *      value = the auth user id, ~1 hour expiry).
 *   2. Read that token back from the shared Neon database (this backend
 *      owns the database; no email round-trip is needed).
 *   3. POST /reset-password — the auth service itself hashes the new
 *      password and updates neon_auth.account, consuming the token.
 * Every failure returns a real error: a caller must never report success
 * for a password that was not actually set (REG-58 — previously the
 * password field was silently ignored and success was fabricated).
 */
async function setNeonAuthPassword(params: {
  authUserId: string;
  email: string;
  newPassword: string;
}): Promise<{ error: { message: string } | null }> {
  const baseUrl = process.env.NEON_AUTH_BASE_URL;
  if (!baseUrl) {
    return { error: { message: "NEON_AUTH_BASE_URL is not configured" } };
  }
  const appOrigin = (
    process.env.NEXT_PUBLIC_APP_URL || "https://anchorfashion.com"
  ).replace(/\/+$/, "");
  const headers = {
    "Content-Type": "application/json",
    Origin: appOrigin,
    Referer: `${appOrigin}/admin/users`,
  };

  // 1. Ask the auth service to mint a reset token for this user.
  const requestRes = await fetch(`${baseUrl}/request-password-reset`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      email: params.email,
      redirectTo: `${appOrigin}/auth/reset-password`,
    }),
  });
  if (!requestRes.ok) {
    const body: any = await requestRes.json().catch(() => ({}));
    return {
      error: {
        message:
          body?.message ||
          `Password reset request failed (${requestRes.status})`,
      },
    };
  }

  // 2. Read back the token just stored for THIS user.
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT identifier FROM neon_auth."verification"
     WHERE identifier LIKE 'reset-password:%' AND value = $1
       AND "expiresAt" > NOW()
     ORDER BY "createdAt" DESC LIMIT 1`,
    params.authUserId
  );
  const identifier = rows?.[0]?.identifier
    ? String(rows[0].identifier)
    : null;
  if (!identifier) {
    return {
      error: {
        message:
          "The auth service did not issue a reset token; the password was not changed.",
      },
    };
  }
  const token = identifier.slice("reset-password:".length);

  // 3. Redeem it — the auth service hashes and stores the new credential
  //    and consumes the token.
  const resetRes = await fetch(`${baseUrl}/reset-password`, {
    method: "POST",
    headers,
    body: JSON.stringify({ token, newPassword: params.newPassword }),
  });
  if (!resetRes.ok) {
    const body: any = await resetRes.json().catch(() => ({}));
    // Do not leave a live reset token behind after a failed attempt.
    await prisma
      .$executeRawUnsafe(
        `DELETE FROM neon_auth."verification" WHERE identifier = $1`,
        identifier
      )
      .catch(() => {});
    return {
      error: {
        message: body?.message || `Password reset failed (${resetRes.status})`,
      },
    };
  }
  return { error: null };
}

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
          // REG-58: a password change must reach the auth credential —
          // it used to be silently dropped here while success was
          // returned. Set it through the auth layer and surface any
          // failure to the caller.
          if (
            typeof updates?.password === "string" &&
            updates.password.length > 0
          ) {
            const email = (user as any)?.email;
            if (!email) {
              return {
                data: null,
                error: { message: "Authentication required. Please log in again." },
              };
            }
            const pwResult = await setNeonAuthPassword({
              authUserId: user.id,
              email,
              newPassword: updates.password,
            });
            if (pwResult.error) {
              return { data: null, error: pwResult.error };
            }
          }
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
    // REG-58: this used to return a fabricated success without contacting
    // the auth service — no reset email was ever sent. It now performs the
    // real request through the auth layer and surfaces failures.
    try {
      const redirectTo = opts?.redirectTo;
      if (typeof window !== "undefined") {
        const { authClient } = await import("@/lib/auth/client");
        const client: any = authClient as any;
        const requestReset =
          client.requestPasswordReset || client.forgetPassword;
        if (typeof requestReset !== "function") {
          return {
            data: null,
            error: { message: "Password reset is not available." },
          };
        }
        const res = await requestReset.call(client, { email, redirectTo });
        if (res?.error) {
          return {
            data: null,
            error: {
              message: res.error.message || "Failed to send reset password link",
            },
          };
        }
        return { data: {}, error: null };
      }
      const baseUrl = process.env.NEON_AUTH_BASE_URL;
      if (!baseUrl) {
        return {
          data: null,
          error: { message: "NEON_AUTH_BASE_URL is not configured" },
        };
      }
      const appOrigin = (
        process.env.NEXT_PUBLIC_APP_URL || "https://anchorfashion.com"
      ).replace(/\/+$/, "");
      const res = await fetch(`${baseUrl}/request-password-reset`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: appOrigin,
          Referer: `${appOrigin}/auth/forgot-password`,
        },
        body: JSON.stringify({
          email,
          redirectTo: redirectTo || `${appOrigin}/auth/reset-password`,
        }),
      });
      if (!res.ok) {
        const body: any = await res.json().catch(() => ({}));
        return {
          data: null,
          error: {
            message: body?.message || "Failed to send reset password link",
          },
        };
      }
      return { data: {}, error: null };
    } catch (e: any) {
      return {
        data: null,
        error: { message: e?.message || "Failed to send reset password link" },
      };
    }
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
        const email = String(userData.email || "").trim().toLowerCase();
        const fullName =
          `${
            userData.user_metadata?.first_name || userData.first_name || ""
          } ${
            userData.user_metadata?.last_name || userData.last_name || ""
          }`.trim() || email.split("@")[0];

        // 1. Provision the Neon Auth identity FIRST (BUG FIX: the previous
        // implementation POSTed to sign-up/email WITHOUT an Origin header —
        // Better Auth rejects such calls — and never checked the response,
        // so auth creation failed silently and only a shell `profiles` row
        // was created; admin-created users could never log in. This now
        // follows the proven pattern in lib/services/auth/account-claim.service.ts:
        // explicit Origin/Referer, response checked, auth id captured.)
        let authUserId: string | null = null;
        let identityAlreadyExisted = false;
        if (userData.password) {
          const baseUrl = process.env.NEON_AUTH_BASE_URL;
          if (!baseUrl) {
            return {
              data: { user: null },
              error: { message: "NEON_AUTH_BASE_URL is not configured" },
            };
          }
          const appOrigin = (
            process.env.NEXT_PUBLIC_APP_URL || "https://anchorfashion.com"
          ).replace(/\/+$/, "");
          const res = await fetch(`${baseUrl}/sign-up/email`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin: appOrigin,
              Referer: `${appOrigin}/admin/users`,
            },
            body: JSON.stringify({
              email,
              password: userData.password,
              name: fullName,
            }),
          });
          const json: any = await res.json().catch(() => ({}));
          if (res.ok) {
            authUserId = json?.user?.id || json?.data?.user?.id || null;
          } else {
            const code = String(json?.code || "");
            const alreadyExists =
              code.includes("USER_ALREADY_EXISTS") ||
              /already exists/i.test(String(json?.message || ""));
            if (!alreadyExists) {
              // Real failure: surface it and do NOT create a shell profile.
              return {
                data: { user: null },
                error: {
                  message:
                    json?.message || "Failed to create the auth user",
                },
              };
            }
            // Email already has an auth identity — link to it below instead
            // of duplicating, and apply the password the admin entered to
            // that identity (REG-58: it used to be dropped silently).
            identityAlreadyExisted = true;
          }
          if (!authUserId) {
            // Resolve the auth user id from the shared Neon database.
            try {
              const rows: any[] = await prisma.$queryRawUnsafe(
                `SELECT id FROM neon_auth."user" WHERE lower(email) = lower($1) LIMIT 1`,
                email
              );
              authUserId = rows?.[0]?.id ? String(rows[0].id) : null;
            } catch {
              // neon_auth schema not readable from this connection — fall through.
            }
          }
          if (!authUserId) {
            return {
              data: { user: null },
              error: {
                message:
                  "The auth user could not be provisioned; no profile was created.",
              },
            };
          }
          if (identityAlreadyExisted) {
            // The admin entered a password for an email that already has
            // credentials: set it on the existing identity BEFORE writing
            // any profile, and fail loudly if the auth write fails.
            const pwResult = await setNeonAuthPassword({
              authUserId,
              email,
              newPassword: userData.password,
            });
            if (pwResult.error) {
              return { data: { user: null }, error: pwResult.error };
            }
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

        // 3. Upsert profile in Neon DB, bound to the auth identity: the
        // profile id MUST equal the Neon Auth user id, otherwise the
        // signed-in user never resolves to this profile/role. A pre-existing
        // shell profile for the same email (created by the old broken flow)
        // is rebound to the auth id — referencing FKs are ON UPDATE CASCADE,
        // the same mechanism account-claim.service.ts relies on.
        let existing = await prisma.profile.findFirst({
          where: { email: { equals: email, mode: "insensitive" } },
        });

        if (existing && authUserId && existing.id !== authUserId) {
          await prisma.$executeRawUnsafe(
            `UPDATE profiles SET id = $1::uuid WHERE id = $2::uuid`,
            authUserId,
            existing.id
          );
          existing = await prisma.profile.findFirst({
            where: { email: { equals: email, mode: "insensitive" } },
          });
        }

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
              ...(authUserId ? { id: authUserId } : {}),
              email,
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
        // Never fabricate a user id on failure — callers must see the error
        // and no shell profile may be left behind.
        return {
          data: { user: null },
          error: { message: e?.message || "Failed to create user" },
        };
      }
    },
    updateUserById: async (
      id: string,
      updates: any
    ): Promise<{ data: { user: any }; error: { message: string } | null }> => {
      try {
        // REG-58: a password in the payload is a CREDENTIAL change, not a
        // profile field. It used to be silently ignored here while success
        // was returned — admins set passwords that never took effect. Set
        // it through the auth layer FIRST; on failure, return the error
        // and write nothing, so profile and credential never diverge
        // under a false "success".
        if (
          typeof updates.password === "string" &&
          updates.password.length > 0
        ) {
          const profile = await prisma.profile.findUnique({
            where: { id },
            select: { email: true },
          });
          let email = profile?.email || null;
          let authUserId: string | null = null;
          if (email) {
            const byEmail: any[] = await prisma.$queryRawUnsafe(
              `SELECT id FROM neon_auth."user" WHERE lower(email) = lower($1) LIMIT 1`,
              email
            );
            authUserId = byEmail?.[0]?.id ? String(byEmail[0].id) : null;
          }
          if (!authUserId) {
            const byId: any[] = await prisma.$queryRawUnsafe(
              `SELECT id, email FROM neon_auth."user" WHERE id = $1::uuid LIMIT 1`,
              id
            );
            if (byId?.[0]?.id) {
              authUserId = String(byId[0].id);
              email = email || byId[0].email || null;
            }
          }
          if (!authUserId || !email) {
            return {
              data: { user: null },
              error: {
                message:
                  "No auth identity found for this user; the password was not changed.",
              },
            };
          }
          const pwResult = await setNeonAuthPassword({
            authUserId,
            email,
            newPassword: updates.password,
          });
          if (pwResult.error) {
            return { data: { user: null }, error: pwResult.error };
          }
        }

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
          data: { user: null },
          error: { message: e?.message || "Failed to update user" },
        };
      }
    },
  },
};
