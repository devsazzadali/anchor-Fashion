"use server";

import { revalidatePath } from "next/cache";
import { ReturnsService } from "@/services/shipping/returns.service";
import {
  createReturnSchema,
  approveReturnSchema,
  rejectReturnSchema,
  returnFiltersSchema,
  submitCustomerReturnSchema,
} from "@/schemas/shipping.schema";
import { createAdminDbClient } from "@/lib/db/client";
import {
  PaginatedResult,
  ReturnEligibilityResult,
  ReturnRequest,
  ReturnWithItems,
} from "@/types/shipping.types";
import { verifyAuthenticated, verifyStaff } from "@/lib/security/roles";

type ActionResponse<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

async function getCurrentUser() {
  try {
    const { getServerSession } = await import("@/lib/auth/server");
    const { user } = await getServerSession();
    return user;
  } catch {
    return null;
  }
}

async function requireBranchAccess(returnId: string) {
  const user = await getCurrentUser();
  
  const { resolveUserRole } = await import("@/lib/auth/server");
  const role = user ? await resolveUserRole(user) : "CUSTOMER";
  const staffRoleList = [
    "SUPERADMIN",
    "SUPER_ADMIN",
    "ADMIN",
    "MANAGER",
    "WAREHOUSE_MANAGER",
    "MARKETING_MANAGER",
    "FINANCE_MANAGER",
    "STAFF",
    "SUPPORT",
    "OPERATIONS",
  ];

  // Strictly enforce staff permissions
  if (!user || !staffRoleList.includes(role)) {
    throw new Error("Unauthorized: Insufficient staff permissions.");
  }

  // FIX ROUND 28 (sweep): the branch-scoping block that stood here
  // read branch_id/roles from an `employee_profiles` table that does
  // not exist (and orders.branch_id, which also does not exist), so
  // it could never fire. It is removed outright: Anchor is a SINGLE
  // online store with no branches (owner decision, Phase 10), so
  // there is no branch scope to enforce — the staff-role check above
  // is the access gate for returns.

  return true;
}

// ============================================================================
// Customer Self-Service Actions
// ============================================================================

/**
 * Check authoritative return eligibility for an order
 */
export async function checkReturnEligibilityAction(
  orderId: string
): Promise<ActionResponse<ReturnEligibilityResult>> {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyAuthenticated();
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: "Please log in to check return eligibility." };
    }

    const service = new ReturnsService();
    const result = await service.checkReturnEligibility(orderId, user.id);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Submit a customer return request
 */
export async function submitCustomerReturnAction(
  raw: Record<string, any>
): Promise<ActionResponse<{ returnId: string; returnNumber: string }>> {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyAuthenticated();
  const parse = submitCustomerReturnSchema.safeParse(raw);
  if (!parse.success) {
    return {
      success: false,
      error: parse.error.errors[0]?.message ?? "Validation failed",
    };
  }

  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: "Please log in to submit a return request." };
    }

    const service = new ReturnsService();
    const returnRecord = await service.submitCustomerReturn(
      parse.data,
      user.id
    );

    revalidatePath("/account/returns");
    revalidatePath(`/account/orders/${parse.data.orderId}`);
    revalidatePath("/admin/shipping/returns");

    return {
      success: true,
      data: {
        returnId: returnRecord.id,
        returnNumber: returnRecord.return_number,
      },
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Fetch all returns for the authenticated customer
 */
export async function fetchCustomerReturnsAction(): Promise<
  ActionResponse<ReturnWithItems[]>
> {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyAuthenticated();
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: "Please log in to view returns." };
    }

    const service = new ReturnsService();
    const returns = await service.getCustomerReturns(user.id);
    return { success: true, data: returns };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Fetch return details for a specific return owned by customer
 */
export async function fetchCustomerReturnDetailAction(
  returnId: string
): Promise<ActionResponse<ReturnWithItems>> {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyAuthenticated();
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: "Please log in to view return details." };
    }

    const service = new ReturnsService();
    const returnRecord = await service.getCustomerReturnDetail(returnId, user.id);
    if (!returnRecord) {
      return { success: false, error: "Return record not found." };
    }

    return { success: true, data: returnRecord };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Secure Photo Proof Upload for returns
 */
export async function uploadReturnProofAction(
  formData: FormData
): Promise<ActionResponse<{ url: string }>> {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyAuthenticated();
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: "Authentication required to upload proof." };
    }

    const file = formData.get("file") as File | null;
    if (!file) {
      return { success: false, error: "No image file provided." };
    }

    // 1. Validate MIME type
    const validMimes = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
    if (!validMimes.includes(file.type.toLowerCase())) {
      return {
        success: false,
        error: "Invalid file type. Only JPG, PNG, and WebP images are permitted.",
      };
    }

    // 2. Validate file size (max 5MB)
    const maxSizeBytes = 5 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      return {
        success: false,
        error: "File size exceeds 5MB limit. Please upload a smaller image.",
      };
    }

    // 3. Upload to return_proofs storage bucket
    const adminDb = createAdminDbClient();
    const timestamp = Date.now();
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const filePath = `${user.id}/${timestamp}_${sanitizedName}`;

    const buffer = Buffer.from(await file.arrayBuffer());

    const { data: uploadData, error: uploadErr } = await adminDb.storage
      .from("return_proofs")
      .upload(filePath, buffer, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadErr) {
      throw new Error(`Upload failed: ${uploadErr.message}`);
    }

    // Blob mode: persist the absolute Blob URL from the upload result.
    const { data: publicData } = adminDb.storage
      .from("return_proofs")
      .getPublicUrl(filePath);

    return {
      success: true,
      data: {
        url: uploadData?.path?.startsWith("http")
          ? uploadData.path
          : publicData.publicUrl,
      },
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ============================================================================
// Admin & Management Actions
// ============================================================================

export async function createReturnRequestAction(
  raw: Record<string, any>
): Promise<ActionResponse<{ returnId: string; returnNumber: string }>> {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  const parse = createReturnSchema.safeParse(raw);
  if (!parse.success) {
    return {
      success: false,
      error: parse.error.errors[0]?.message ?? "Validation failed",
    };
  }

  try {
    const user = await getCurrentUser();
    const service = new ReturnsService();
    const returnRecord = await service.createReturnRequest(
      parse.data,
      user?.id,
      user?.id
    );

    revalidatePath("/admin/shipping/returns");
    revalidatePath(`/admin/orders/${parse.data.orderId}`);

    return {
      success: true,
      data: {
        returnId: returnRecord.id,
        returnNumber: returnRecord.return_number,
      },
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function approveReturnAction(
  returnId: string
): Promise<ActionResponse<{ returnId: string }>> {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  const parse = approveReturnSchema.safeParse({ returnId });
  if (!parse.success) {
    return { success: false, error: "Invalid return ID" };
  }

  try {
    await requireBranchAccess(returnId);
    const user = await getCurrentUser();
    const service = new ReturnsService();
    await service.approveReturn(returnId, user?.id);

    revalidatePath("/admin/shipping/returns");
    revalidatePath("/admin/orders/returns");
    revalidatePath(`/admin/orders/returns/${returnId}`);
    revalidatePath("/admin/shipping/returns");
    revalidatePath(`/admin/shipping/returns/${returnId}`);

    return { success: true, data: { returnId } };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function rejectReturnAction(
  returnId: string,
  reason: string
): Promise<ActionResponse<{ returnId: string }>> {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  const parse = rejectReturnSchema.safeParse({ returnId, reason });
  if (!parse.success) {
    return {
      success: false,
      error: parse.error.errors[0]?.message ?? "Validation failed",
    };
  }

  try {
    await requireBranchAccess(returnId);
    const user = await getCurrentUser();
    const service = new ReturnsService();
    await service.rejectReturn(returnId, reason, user?.id);

    revalidatePath("/admin/orders/returns");
    revalidatePath(`/admin/orders/returns/${returnId}`);
    revalidatePath("/admin/shipping/returns");
    revalidatePath(`/admin/shipping/returns/${returnId}`);

    return { success: true, data: { returnId } };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function fetchReturnsAction(
  rawFilters: Record<string, any> = {}
): Promise<ActionResponse<PaginatedResult<ReturnRequest>>> {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  const parse = returnFiltersSchema.safeParse(rawFilters);
  if (!parse.success) {
    return { success: false, error: "Invalid filters" };
  }

  try {
    const user = await getCurrentUser();
    let branchId: string | undefined;

    // FIX ROUND 28 (sweep): this block read branch_id/roles from the
    // phantom `employee_profiles` table, so branchId was always
    // undefined and the admin determination effectively already rested
    // on the metadata role alone. Anchor is a single online store with
    // no branches (Phase 10) — branchId stays undefined (unscoped list
    // for authorized staff, gated by verifyStaff/role checks in the
    // service path) and the dead read is removed.
    void branchId;

    const filters = { ...parse.data, branchId };

    const service = new ReturnsService();
    const result = await service.listReturns(filters);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// REG-65 holdout: the return type stays loosely typed — narrowing it
// to the declared return shape breaks the admin returns page, whose
// status comparisons narrow against the declared union in one branch.
// A future functional batch should reconcile the page branch with the
// declared status union; a type-only edit cannot.
export async function fetchReturnByIdAction(
  returnId: string
): Promise<ActionResponse<any>> {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    if (!returnId || returnId === "undefined") {
      return { success: false, error: "Return ID is required" };
    }
    await requireBranchAccess(returnId);
    const service = new ReturnsService();
    const returnRecord = await service.getReturnWithItems(returnId);

    if (!returnRecord) return { success: false, error: "Return not found" };
    return { success: true, data: returnRecord };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function markReturnReceivedAction(
  returnId: string
): Promise<ActionResponse<{ returnId: string }>> {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    await requireBranchAccess(returnId);
    const user = await getCurrentUser();
    const service = new ReturnsService();
    await service.markReturnReceived(returnId, user?.id);

    revalidatePath("/admin/orders/returns");
    revalidatePath(`/admin/orders/returns/${returnId}`);
    revalidatePath("/admin/shipping/returns");
    revalidatePath(`/admin/shipping/returns/${returnId}`);

    return { success: true, data: { returnId } };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function syncReturnInventoryAction(
  returnId: string,
  itemConditions: Record<string, "good" | "damaged" | "defective"> = {}
): Promise<ActionResponse<{ returnId: string }>> {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    await requireBranchAccess(returnId);
    const user = await getCurrentUser();
    const service = new ReturnsService();
    await service.processReturnRestock(returnId, itemConditions, user?.id);

    revalidatePath("/admin/orders/returns");
    revalidatePath(`/admin/orders/returns/${returnId}`);
    revalidatePath("/admin/shipping/returns");
    revalidatePath(`/admin/shipping/returns/${returnId}`);

    return { success: true, data: { returnId } };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function completeReturnAction(
  returnId: string
): Promise<ActionResponse<{ returnId: string }>> {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    await requireBranchAccess(returnId);
    const user = await getCurrentUser();
    const service = new ReturnsService();
    await service.completeReturn(returnId, user?.id);

    revalidatePath("/admin/orders/returns");
    revalidatePath(`/admin/orders/returns/${returnId}`);
    revalidatePath("/admin/shipping/returns");
    revalidatePath(`/admin/shipping/returns/${returnId}`);

    return { success: true, data: { returnId } };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function processReturnRefundAction(
  returnId: string
): Promise<ActionResponse<{ success: boolean; method: string; refundRef?: string }>> {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    await requireBranchAccess(returnId);
    const user = await getCurrentUser();
    const service = new ReturnsService();
    const result = await service.processReturnRefund(returnId, user?.id);

    revalidatePath("/admin/orders/returns");
    revalidatePath(`/admin/orders/returns/${returnId}`);
    revalidatePath("/admin/shipping/returns");
    revalidatePath(`/admin/shipping/returns/${returnId}`);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function resolveReturnRefundAction(
  returnId: string,
  options?: {
    refundMethod?: "WALLET" | "MANUAL_BANK" | "MANUAL_CASH" | "GATEWAY_CONFIRMED";
    note?: string;
  }
): Promise<ActionResponse<{ returnId: string; refundStatus: string; status: string }>> {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    await requireBranchAccess(returnId);
    const user = await getCurrentUser();
    const service = new ReturnsService();
    const result = await service.resolveReturnWithRefund(returnId, options, user?.id);

    revalidatePath("/admin/orders/returns");
    revalidatePath(`/admin/orders/returns/${returnId}`);
    revalidatePath("/admin/shipping/returns");
    revalidatePath(`/admin/shipping/returns/${returnId}`);
    revalidatePath("/account/returns");
    revalidatePath(`/account/returns/${returnId}`);

    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
