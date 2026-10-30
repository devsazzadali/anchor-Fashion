import { NextRequest, NextResponse } from "next/server";
import { InventoryRepository } from "@/repositories/inventory.repository";
import { verifyManager } from "@/lib/security/roles";

export async function POST(request: NextRequest) {
  try {
    // REG-72: stock adjustments rewrite quantities on a manager's say-so —
    // a stock-affecting write requires a manager-level role, not any staff
    // account (SUPPORT/MARKETING were previously enough).
    await verifyManager();
    const body = await request.json();
    if (!body.variant_id || !body.warehouse_id || body.physical_count === undefined || !body.reason) {
      return NextResponse.json(
        { error: "Missing required fields: variant_id, warehouse_id, physical_count, reason" },
        { status: 400 }
      );
    }

    const repo = new InventoryRepository();
    const result = await repo.stockAdjustment({
      variant_id: body.variant_id,
      warehouse_id: body.warehouse_id,
      bin_id: body.bin_id,
      physical_count: body.physical_count,
      reason: body.reason,
      notes: body.notes,
    });

    return NextResponse.json({ success: true, data: result.updated, variance: result.variance });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.message?.includes("Forbidden") ? 403 : 400 });
  }
}
