import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { verifyStaff } from "@/lib/security/roles";
import { authErrorResponse } from "@/lib/api/auth-error";

export const dynamic = "force-dynamic";

// REG-65: the three fields this route's aggregates read off ai_request_logs rows.
interface AiRequestLogRow {
  cost_estimated_usd?: number | string | null;
  latency_ms?: number | null;
  status?: string | null;
}

export async function GET(req: NextRequest) {
  try {
    await verifyStaff();
    // For a real dashboard, you'd aggregate this in SQL, but for MVP we fetch top logs
    const { data, error } = await db
      .from("ai_request_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    // Calculate quick aggregates
    const safeData: AiRequestLogRow[] = data || [];
    const aggregates = {
      totalRequests: safeData.length,
      totalCost: safeData.reduce(
        (acc: number, log: AiRequestLogRow) => acc + Number(log.cost_estimated_usd || 0),
        0
      ),
      avgLatency: safeData.length
        ? safeData.reduce((acc: number, log: AiRequestLogRow) => acc + (log.latency_ms || 0), 0) / safeData.length
        : 0,
      errors: safeData.filter((log: AiRequestLogRow) => log.status === "error").length,
    };

    return NextResponse.json({
      aggregates,
      recentLogs: data,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
