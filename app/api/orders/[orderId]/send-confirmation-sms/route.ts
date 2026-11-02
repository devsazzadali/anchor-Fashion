import { NextRequest, NextResponse } from "next/server";
import { AlphaSmsService } from "@/lib/services/sms/alpha-sms.service";
import { createDbClient } from "@/lib/db/client";
import { createAdminDbClient } from "@/lib/db/client";

/**
 * POST /api/orders/:orderId/send-confirmation-sms
 * Triggers or resends confirmation SMS for a confirmed order
 * Query params: ?force=true (bypass duplicate check, staff/admin only)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    if (!orderId) {
      return NextResponse.json({ error: "Missing orderId in route" }, { status: 400 });
    }

    let user = null;
    try {
      const db = await createDbClient();
      const { data, error: authError } = await db.auth.getUser();
      if (!authError && data?.user) {
        user = data.user;
      }
    } catch {
      // Cookies context unavailable or threw
    }

    if (!user) {
      const authHeader = req.headers.get("authorization");
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.replace("Bearer ", "").trim();
        const adminDb = createAdminDbClient();
        const { data: tokenData } = await adminDb.auth.getUser(token);
        if (tokenData?.user) {
          user = tokenData.user;
        }
      }
    }

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminDb = createAdminDbClient();
    const { data: order } = await adminDb
      .from("orders")
      .select("id, customer_id, created_by")
      .eq("id", orderId)
      .maybeSingle();

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // FIX ROUND 28 (m-8): staff status comes from the canonical
    // profiles-table resolver (lib/auth/server::resolveUserRole), NOT
    // from auth metadata — user_metadata can be user-editable, which
    // made this gate escalate-able, and the old role names
    // ("ops_manager", "warehouse_staff") are not roles-table names.
    const { resolveUserRole } = await import("@/lib/auth/server");
    const role = (await resolveUserRole(user as any)).toUpperCase();
    const isStaffOrAdmin = [
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
    ].includes(role);
    const isOwner = order.customer_id === user.id || order.created_by === user.id;

    if (!isStaffOrAdmin && !isOwner) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const force = isStaffOrAdmin && searchParams.get("force") === "true";

    const result = await AlphaSmsService.sendOrderConfirmationSMS(orderId, {
      force,
    });

    return NextResponse.json(
      {
        success: result.success,
        status: result.status,
        recipient: result.phone,
        message: result.message,
        requestId: result.requestId || null,
        skipped: !!result.skipped,
        reason: result.reason || null,
        error: result.error || null,
      },
      { status: result.success ? 200 : 400 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: "Internal Server Error", details: (error as Error).message },
      { status: 500 }
    );
  }
}
