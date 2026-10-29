import { NextResponse } from "next/server";
import { createAdminDbClient } from "@/lib/db/client";
import { verifyStaff } from "@/lib/security/roles";
import { authErrorResponse } from "@/lib/api/auth-error";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ courierId: string }> }
) {
  try {
    await verifyStaff();

    const { courierId } = await params;
    const adminDb = createAdminDbClient();

    // Look up courier code
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        courierId
      );

    let courierCode = courierId;
    if (isUuid) {
      const { data: record } = await adminDb
        .from("courier_providers")
        .select("code")
        .eq("id", courierId)
        .maybeSingle();
      if (record?.code) {
        courierCode = record.code;
      }
    }

    const { data: logs, error: logsError } = await adminDb
      .from("courier_api_logs")
      .select("*")
      .eq("courier_code", courierCode)
      .order("created_at", { ascending: false })
      .limit(50);

    if (logsError) {
      return NextResponse.json({ success: true, data: [] });
    }

    return NextResponse.json({
      success: true,
      data: logs || [],
    });
  } catch (err: any) {
    return authErrorResponse(err);
  }
}
