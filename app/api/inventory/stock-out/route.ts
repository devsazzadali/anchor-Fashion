import { NextRequest, NextResponse } from "next/server";
import { InventoryRepository } from "@/repositories/inventory.repository";
import { verifyManager } from "@/lib/security/roles";
import { authErrorResponse } from "@/lib/api/auth-error";

export async function POST(request: NextRequest) {
  try {
    // REG-72: writing stock out is a shrinkage/fraud surface — requires a
    // manager-level role, not any staff account.
    await verifyManager();
    const body = await request.json();
    if (!body.variant_id || !body.warehouse_id || !body.quantity) {
      return NextResponse.json(
        { error: "Missing required fields: variant_id, warehouse_id, quantity" },
        { status: 400 }
      );
    }

    const repo = new InventoryRepository();
    const result = await repo.stockOut({
      variant_id: body.variant_id,
      warehouse_id: body.warehouse_id,
      bin_id: body.bin_id,
      quantity: body.quantity,
      reason: body.reason || "STOCK_OUT",
      notes: body.notes,
      reference_id: body.reference_id,
    });
    return NextResponse.json({ success: true, data: result }, { status: 200 });
  } catch (error) {
    // FIX ROUND 28 (m-1): auth failures must not collapse to 400 —
    // authErrorResponse maps Unauthorized→401, Forbidden→403, else 400.
    return authErrorResponse(error, 400);
  }
}
