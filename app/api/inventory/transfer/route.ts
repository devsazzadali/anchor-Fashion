import { NextRequest, NextResponse } from "next/server";
import { InventoryRepository } from "@/repositories/inventory.repository";
import { verifyManager } from "@/lib/security/roles";

export async function POST(request: NextRequest) {
  try {
    // REG-72: inter-warehouse transfers move sellable stock — requires a
    // manager-level role, not any staff account.
    const user = await verifyManager();
    const body = await request.json();
    if (!body.variant_id || !body.from_warehouse_id || !body.to_warehouse_id || !body.quantity) {
      return NextResponse.json(
        { error: "Missing required fields: variant_id, from_warehouse_id, to_warehouse_id, quantity" },
        { status: 400 }
      );
    }

    const repo = new InventoryRepository();
    await repo.transferStock(
      body.variant_id,
      body.from_warehouse_id,
      body.to_warehouse_id,
      body.quantity,
      body.reason || "WAREHOUSE_TRANSFER",
      body.notes,
      (user as any)?.id
    );
    return NextResponse.json({ success: true, message: "Stock transferred successfully." });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.message?.includes("Forbidden") ? 403 : 400 });
  }
}
