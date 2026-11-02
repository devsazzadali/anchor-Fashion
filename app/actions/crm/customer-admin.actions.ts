"use server";

import { createAdminDbClient } from "@/lib/db/client";
import { verifyAdmin } from "@/lib/security/roles";
import { revalidatePath } from "next/cache";
import { CustomerLifecycleStage } from "@/features/crm/components/CustomersList";

export interface UpdateCustomerData {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  lifecycleStage?: CustomerLifecycleStage;
  isVip?: boolean;
  password?: string;
}

export async function updateCustomerByAdminAction(
  data: UpdateCustomerData
): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. Strictly verify the caller is an Admin or Super Admin
    await verifyAdmin();

    const cleanId = data.id?.trim();
    const cleanFirstName = data.firstName?.trim();
    const cleanLastName = data.lastName?.trim() || "";
    const cleanEmail = data.email?.trim().toLowerCase();
    const cleanPhone = data.phone?.trim() ? data.phone.trim() : null;
    const cleanPassword = data.password?.trim();

    if (!cleanId) {
      return { success: false, error: "Customer ID is required." };
    }
    if (!cleanFirstName) {
      return { success: false, error: "First name is required." };
    }
    if (!cleanEmail) {
      return { success: false, error: "Email address is required." };
    }
    if (cleanPassword && cleanPassword.length < 6) {
      return {
        success: false,
        error: "Password must be at least 6 characters long.",
      };
    }

    const db = createAdminDbClient();

    // 2. Check for duplicate email across other customer profiles
    const { data: existingEmail } = await db
      .from("profiles")
      .select("id, email")
      .ilike("email", cleanEmail)
      .neq("id", cleanId)
      .maybeSingle();

    if (existingEmail) {
      return {
        success: false,
        error: `Email "${cleanEmail}" is already registered to another customer.`,
      };
    }

    // 3. Check for duplicate phone across other customer profiles if phone provided
    if (cleanPhone) {
      const { data: existingPhone } = await db
        .from("profiles")
        .select("id, phone")
        .eq("phone", cleanPhone)
        .neq("id", cleanId)
        .maybeSingle();

      if (existingPhone) {
        return {
          success: false,
          error: `Phone number "${cleanPhone}" is already assigned to another customer.`,
        };
      }
    }

    // 4. Update Neon Auth user (email, password, user_metadata)
    const authUpdates: {
      email?: string;
      password?: string;
      user_metadata?: Record<string, any>;
    } = {
      email: cleanEmail,
      user_metadata: {
        first_name: cleanFirstName,
        last_name: cleanLastName,
        full_name: `${cleanFirstName} ${cleanLastName}`.trim(),
        phone: cleanPhone || "",
      },
    };

    if (cleanPassword) {
      authUpdates.password = cleanPassword;
      authUpdates.user_metadata = {
        ...authUpdates.user_metadata,
        assigned_password: cleanPassword,
      };
    }

    const { error: authErr } = await db.auth.admin.updateUserById(
      cleanId,
      authUpdates
    );
    if (authErr) {
    }

    // 5. Update customer_profiles table
    const { error: custErr } = await db
      .from("profiles")
      .update({
        first_name: cleanFirstName,
        last_name: cleanLastName,
        email: cleanEmail,
        phone: cleanPhone,
        updated_at: new Date().toISOString(),
      })
      .eq("id", cleanId);

    if (custErr) {
      throw custErr;
    }

    // 6. Sync with public profiles table
    try {
      await db
        .from("profiles")
        .update({
          first_name: cleanFirstName,
          last_name: cleanLastName,
          email: cleanEmail,
          phone: cleanPhone,
        })
        .eq("id", cleanId);
    } catch {
      // non-fatal if profiles table row does not exist
    }

    // 7. CRM customer metadata (lifecycleStage, isVip)
    if (data.lifecycleStage || data.isVip !== undefined) {
      // FIX ROUND 28 (M-2, PROPOSAL): the crm_customers table does NOT
      // exist in this schema — the upsert that stood here was silently
      // discarded, so lifecycle/VIP edits never persisted while the UI
      // reported success. The table is specified in the Round-28 DDL
      // proposal; until it lands, fail honestly.
      return {
        success: false,
        error:
          "CRM metadata (lifecycle stage / VIP) cannot be saved yet — the crm_customers table is pending a schema update. Profile details were saved.",
      };
    }

    // 8. Revalidate all related CRM paths
    revalidatePath("/admin/customers");
    revalidatePath(`/admin/customers/${cleanId}`);
    revalidatePath("/manager/customers");

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: (error as Error)?.message || "Failed to update customer details.",
    };
  }
}

export async function deleteCustomerByAdminAction(
  customerId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. Strictly verify caller is an Admin or Super Admin
    const currentUser = await verifyAdmin();

    const cleanId = customerId?.trim();
    if (!cleanId) {
      return { success: false, error: "Customer ID is required." };
    }

    if (currentUser.id === cleanId) {
      return {
        success: false,
        error: "Security violation: You cannot delete your own account.",
      };
    }

    const db = createAdminDbClient();

    // 2. Cascade delete dependent CRM and customer records
    await Promise.allSettled([
      db.from("support_tickets").delete().eq("customer_id", cleanId),
      db.from("customer_addresses").delete().eq("customer_id", cleanId),
      // FIX ROUND 28 (sweep): no customer_notifications delete — that
      // table does not exist in this schema.
      db.from("loyalty_accounts").delete().eq("customer_id", cleanId),
      // FIX ROUND 28 (M-2): no crm_customers delete — that table does
      // not exist in this schema (see the Round-28 DDL proposal).
    ]);

    // 3. Delete customer profile
    const { error: profileErr } = await db
      .from("profiles")
      .delete()
      .eq("id", cleanId);

    if (profileErr) {
      // If there's a foreign key constraint (e.g., historical financial transactions / orders)
      if (profileErr.code === "23503") {
        return {
          success: false,
          error:
            "This customer has historical order or invoice records and cannot be permanently deleted. You can mark them inactive or remove credentials instead.",
        };
      }
      throw profileErr;
    }

    // 4. Delete user profile from profiles table if exists
    try {
      await db.from("profiles").delete().eq("id", cleanId);
    } catch {
      // non-fatal
    }

    // 5. Delete user from Neon Auth
    const { error: authErr } = await db.auth.admin.deleteUser(cleanId);
    if (authErr) {
    }

    // 6. Revalidate routes
    revalidatePath("/admin/customers");
    revalidatePath("/manager/customers");

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: (error as Error)?.message || "Failed to delete customer.",
    };
  }
}

/**
 * S6-4(c): admin wallet adjustment for the customer detail page.
 * Signed amount (positive = credit, negative = debit) + a REQUIRED
 * reason; writes through WalletService.adjustBalance, which records a
 * wallet_transactions audit row (reference_type ADMIN_ADJUSTMENT,
 * reason + admin identity in the description).
 */
export async function adjustCustomerWalletAction(data: {
  customerId: string;
  amount: number;
  reason: string;
}): Promise<{ success: boolean; balance?: number; error?: string }> {
  try {
    const admin = await verifyAdmin();

    const cleanId = data.customerId?.trim();
    const cleanReason = data.reason?.trim();
    const amount = Number(data.amount);

    if (!cleanId) {
      return { success: false, error: "Customer ID is required." };
    }
    if (!cleanReason) {
      return { success: false, error: "A reason is required for wallet adjustments." };
    }
    if (!amount || !Number.isFinite(amount)) {
      return { success: false, error: "Enter a non-zero adjustment amount." };
    }

    const { WalletService } = await import("@/services/wallet.service");
    const adminMarker = admin?.email || admin?.id || "admin";
    const { wallet } = await WalletService.adjustBalance({
      userId: cleanId,
      signedAmount: amount,
      reason: cleanReason,
      adminMarker,
    });

    revalidatePath(`/admin/customers/${cleanId}`);
    return { success: true, balance: Number(wallet.balance) };
  } catch (error) {
    return {
      success: false,
      error: (error as Error)?.message || "Failed to adjust wallet.",
    };
  }
}

export async function getCustomerPasswordAction(
  customerId: string
): Promise<{ success: boolean; password?: string | null; error?: string }> {
  try {
    await verifyAdmin();
    const cleanId = customerId?.trim();
    if (!cleanId) return { success: false, error: "Customer ID is required." };

    const db = createAdminDbClient();
    const { data, error } = await db.auth.admin.getUserById(cleanId);
    if (error) throw error;

    const password = (data.user?.user_metadata as any)?.assigned_password || null;
    return { success: true, password };
  } catch (error) {
    return {
      success: false,
      error: (error as Error)?.message || "Failed to retrieve customer password.",
    };
  }
}
