"use server";

import { createAdminDbClient } from "@/lib/db/client";
import { createDbClient } from "@/lib/db/client";
import { verifyAdmin, verifySelfOrStaff } from "@/lib/security/roles";
import { prisma } from "@/lib/prisma";
import {
  recordAuditForSessionUser,
  AUDIT_ACTIONS,
} from "@/lib/security/audit";
import { revalidatePath } from "next/cache";

export type UserData = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  lastActive: string;
  phone?: string | null;
};

export async function getUsersByRoleAction(roleNames: string[]) {
  try {
    await verifyAdmin();
    const db = createAdminDbClient();

    // 1. Get roles
    const { data: roles, error: rolesError } = await db
      .from("roles")
      .select("*")
      .in("name", roleNames);

    if (rolesError) throw rolesError;
    if (!roles || roles.length === 0) return { success: true, data: [] };

    const roleIds = roles.map((r: any) => r.id);

    // 2. Get profiles
    const { data: profiles, error: profilesError } = await db
      .from("profiles")
      .select("*, roles(*)")
      .in("role_id", roleIds);

    if (profilesError) throw profilesError;

    // 3. Get auth users (admin API) to get emails
    const authRes = await db.auth.admin.listUsers();
    const users = authRes?.data?.users || [];

    // 3b. REG-26: REAL last sign-in. The old code read
    // `authUser.last_sign_in_at` from the admin list — but the Prisma
    // shim behind db.auth.admin.listUsers() builds users from the
    // profiles table and NEVER sets that field, so every account
    // showed "Never". The true source is Neon Auth itself: each
    // sign-in creates a row in neon_auth.session, so MAX(createdAt)
    // per user is the last sign-in. Match profiles by auth id, with
    // an email fallback for legacy profiles whose id predates the
    // auth re-keying.
    const lastSignInById = new Map<string, Date>();
    const lastSignInByEmail = new Map<string, Date>();
    try {
      const sessionRows = await prisma.$queryRaw<
        { user_id: string; email: string | null; last_sign_in: Date }[]
      >`
        SELECT s."userId" AS user_id, u."email" AS email,
               MAX(s."createdAt") AS last_sign_in
        FROM neon_auth.session s
        LEFT JOIN neon_auth."user" u ON u."id" = s."userId"
        GROUP BY s."userId", u."email"
      `;
      for (const row of sessionRows) {
        if (row.user_id && row.last_sign_in) {
          lastSignInById.set(row.user_id, new Date(row.last_sign_in));
        }
        if (row.email && row.last_sign_in) {
          lastSignInByEmail.set(
            row.email.toLowerCase(),
            new Date(row.last_sign_in)
          );
        }
      }
    } catch (err) {
      console.error("[getUsersByRoleAction] last sign-in lookup failed:", err);
    }

    // Merge data
    const mappedUsers: UserData[] = (profiles || []).map((profile: any) => {
      const authUser: any = users.find((u: any) => u.id === profile.id);

      const roleName = Array.isArray(profile.roles)
        ? profile.roles[0]?.name
        : (profile.roles as any)?.name || "Unknown";

      // REG-26: "Never" only when the account has genuinely never
      // signed in (no Neon Auth session rows at all).
      const lastSignIn =
        lastSignInById.get(profile.id) ||
        (profile.email
          ? lastSignInByEmail.get(String(profile.email).toLowerCase())
          : undefined) ||
        (authUser?.email
          ? lastSignInByEmail.get(String(authUser.email).toLowerCase())
          : undefined);
      let lastActiveFormatted = "Never";
      if (lastSignIn && !isNaN(lastSignIn.getTime())) {
        lastActiveFormatted = lastSignIn.toISOString().split("T")[0];
      }

      return {
        id: profile.id,
        name: `${profile.first_name || ""} ${profile.last_name || ""}`.trim() || "Unknown",
        email: authUser?.email || "No email",
        phone: profile.phone || null,
        role: roleName,
        status: profile.is_active ? "Active" : "Inactive",
        lastActive: lastActiveFormatted,
      };
    });

    return { success: true, data: mappedUsers };
  } catch (error: any) {
    console.error("Error fetching users:", error);
    return { success: false, error: error.message || "Failed to fetch users" };
  }
}

export async function createUserAction(data: {
  firstName: string;
  lastName: string;
  email: string;
  roleName: string;
  password?: string;
}) {
  try {
    await verifyAdmin();
    const db = createAdminDbClient();

    // 1. Find role or create fallback if missing
    let { data: role } = await db
      .from("roles")
      .select("id, name")
      .eq("name", data.roleName)
      .maybeSingle();

    if (!role) {
      // If role name like STAFF does not exist, check if there is an existing role or create it
      const { data: newRole, error: createRoleErr } = await db
        .from("roles")
        .insert({
          name: data.roleName,
          description: `${data.roleName} team member`,
        })
        .select("id, name")
        .single();
      
      if (!createRoleErr && newRole) {
        role = newRole;
      } else {
        // Fallback to finding by general staff or marketing
        const { data: fallbackRole } = await db
          .from("roles")
          .select("id, name")
          .in("name", ["STAFF", "SUPPORT", "MARKETING"])
          .limit(1)
          .single();
        role = fallbackRole;
      }
    }

    if (!role) throw new Error("Role not found");

    // 2. Generate or use password
    const tempPassword =
      data.password ||
      Math.random().toString(36).slice(-8) +
      Math.random().toString(36).slice(-8).toUpperCase() +
      "1!A";

    // 3. Create auth user with complete user_metadata
    const { data: authData, error: authError } =
      await db.auth.admin.createUser({
        email: data.email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
          role: data.roleName,
          first_name: data.firstName,
          last_name: data.lastName,
          full_name: `${data.firstName} ${data.lastName}`.trim(),
        },
        app_metadata: {
          role: data.roleName,
        },
      });

    if (authError) throw authError;
    if (!authData.user) throw new Error("Failed to create user in Auth");

    // Explicitly update metadata to ensure JWT synchronization
    await db.auth.admin.updateUserById(authData.user.id, {
      user_metadata: {
        role: data.roleName,
        first_name: data.firstName,
        last_name: data.lastName,
        full_name: `${data.firstName} ${data.lastName}`.trim(),
      },
      app_metadata: {
        role: data.roleName,
      },
    });

    // 4. Create / update profile record
    const { error: profileError } = await db.from("profiles").upsert(
      {
        id: authData.user.id,
        first_name: data.firstName,
        last_name: data.lastName,
        role_id: role.id,
        is_active: true,
      },
      { onConflict: "id" }
    );

    if (profileError) throw profileError;

    // REG-27: audit the creation (actor = the acting admin).
    await recordAuditForSessionUser({
      action: AUDIT_ACTIONS.USER_CREATED,
      entity: "user",
      entityId: authData.user.id,
      newValues: { email: data.email, role: data.roleName },
    });

    revalidatePath("/admin/users/admins");
    revalidatePath("/admin/users/managers");
    revalidatePath("/admin/users/staff");
    revalidatePath("/admin/users");

    return {
      success: true,
      data: {
        password: tempPassword,
        userId: authData.user.id,
      },
    };
  } catch (error: any) {
    console.error("Error creating user:", error);
    return { success: false, error: error.message || "Failed to create user" };
  }
}

export async function toggleUserStatusAction(userId: string, currentStatus: string) {
  try {
    const adminUser = await verifyAdmin();
    if (adminUser.id === userId) {
      return { success: false, error: "You cannot change your own status." };
    }
    const db = createAdminDbClient();
    const newActiveState = currentStatus !== "Active";

    // 1. Update profiles table
    const { error: profErr } = await db
      .from("profiles")
      .update({ is_active: newActiveState })
      .eq("id", userId);

    if (profErr) throw profErr;

    // 2. Ban/unban in auth
    if (!newActiveState) {
      await db.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
    } else {
      await db.auth.admin.updateUserById(userId, { ban_duration: "none" });
    }

    // REG-27: audit the (de)activation (actor = the acting admin).
    await recordAuditForSessionUser({
      action: newActiveState
        ? AUDIT_ACTIONS.USER_ACTIVATED
        : AUDIT_ACTIONS.USER_DEACTIVATED,
      entity: "user",
      entityId: userId,
      oldValues: { is_active: !newActiveState },
      newValues: { is_active: newActiveState },
    });

    revalidatePath("/admin/users/admins");
    revalidatePath("/admin/users/managers");
    revalidatePath("/admin/users/staff");
    revalidatePath("/admin/users");

    return { success: true, newStatus: newActiveState ? "Active" : "Inactive" };
  } catch (error: any) {
    console.error("[toggleUserStatusAction]", error);
    return { success: false, error: error.message || "Failed to update user status" };
  }
}

export async function assignUserRoleAction(userId: string, roleName: string) {
  try {
    await verifyAdmin();
    const db = createAdminDbClient();

    // 1. Find role by name
    const { data: role, error: roleErr } = await db
      .from("roles")
      .select("id, name")
      .eq("name", roleName)
      .single();

    if (roleErr || !role) {
      throw new Error(`Role "${roleName}" not found`);
    }

    // 2. Update profile
    const { error: profErr } = await db
      .from("profiles")
      .update({ role_id: role.id })
      .eq("id", userId);

    if (profErr) throw profErr;

    // 3. Update auth metadata
    await db.auth.admin.updateUserById(userId, {
      user_metadata: { role: role.name },
      app_metadata: { role: role.name },
    });

    revalidatePath("/admin/users/admins");
    revalidatePath("/admin/users/managers");
    revalidatePath("/admin/users/staff");
    revalidatePath("/admin/users");

    return { success: true, role: role.name };
  } catch (error: any) {
    console.error("[assignUserRoleAction]", error);
    return { success: false, error: error.message || "Failed to assign role" };
  }
}

export async function updateUserProfileAction(
  userId: string,
  data: { firstName: string; lastName: string; phone?: string }
) {
  try {
    await verifySelfOrStaff(userId);
    const db = createAdminDbClient();

    const { error: profErr } = await db
      .from("profiles")
      .update({
        first_name: data.firstName,
        last_name: data.lastName,
        phone: data.phone || null,
      })
      .eq("id", userId);

    if (profErr) throw profErr;

    // Sync auth metadata
    await db.auth.admin.updateUserById(userId, {
      user_metadata: {
        first_name: data.firstName,
        last_name: data.lastName,
        full_name: `${data.firstName} ${data.lastName}`.trim(),
      },
    });

    revalidatePath("/admin/users/admins");
    revalidatePath("/admin/users/managers");
    revalidatePath("/admin/users/staff");
    revalidatePath("/admin/users");

    return { success: true };
  } catch (error: any) {
    console.error("[updateUserProfileAction]", error);
    return { success: false, error: error.message || "Failed to update profile" };
  }
}

export async function getAllAvailableRolesAction() {
  try {
    await verifyAdmin();
    const db = createAdminDbClient();
    const { data: roles, error } = await db
      .from("roles")
      .select("id, name, description")
      .order("name", { ascending: true });

    if (error) throw error;
    return { success: true, data: roles || [] };
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to fetch roles" };
  }
}

export async function updateUserPasswordAction(
  arg1: string,
  arg2?: string
) {
  try {
    let targetUserId: string | null = null;
    let newPassword = "";

    if (arg2 !== undefined) {
      // Called as updateUserPasswordAction(userId, newPassword) - requires admin
      await verifyAdmin();
      targetUserId = arg1;
      newPassword = arg2;
    } else {
      // Called as updateUserPasswordAction(newPassword) for current user
      newPassword = arg1;
    }

    if (!newPassword || newPassword.trim().length < 6) {
      return { success: false, error: "Password must be at least 6 characters long." };
    }

    const adminClient = createAdminDbClient();

    if (!targetUserId) {
      const db = await createDbClient();
      const {
        data: { user },
        error: userError,
      } = await db.auth.getUser();

      if (userError || !user) {
        return { success: false, error: "Authentication required. Please log in again." };
      }
      targetUserId = user.id;

      // Try updating via the user session client first so auth session cookies are updated and not revoked
      const { error: sessionUpdateErr } = await db.auth.updateUser({
        password: newPassword.trim(),
      });

      if (sessionUpdateErr) {
        // Fallback to admin client if session client fails
        const { error: updateError } = await adminClient.auth.admin.updateUserById(targetUserId, {
          password: newPassword.trim(),
        });
        if (updateError) throw updateError;
      }
    } else {
      // Admin updating a user's password directly (already authorized above)
      const { error: updateError } = await adminClient.auth.admin.updateUserById(targetUserId, {
        password: newPassword.trim(),
      });

      if (updateError) throw updateError;
    }

    revalidatePath("/admin/users/admins");
    revalidatePath("/admin/users/managers");
    revalidatePath("/admin/users/staff");
    revalidatePath("/admin/users");

    return { success: true };
  } catch (error: any) {
    console.error("[updateUserPasswordAction]", error);
    return { success: false, error: error.message || "Failed to update password" };
  }
}

export async function adminUpdateUserPasswordAction(userId: string, newPassword: string) {
  await verifyAdmin();
  return updateUserPasswordAction(userId, newPassword);
}

export async function syncUserAuthAction(_credentials: { email: string; password: string }) {
  return { success: false, error: "This operation has been disabled for security reasons." };
}

