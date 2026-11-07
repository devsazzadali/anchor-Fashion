import { NextRequest, NextResponse } from "next/server";
import { WarehouseService } from "@/services/warehouse.service";
import { verifyStaff } from "@/lib/security/roles";
import { authErrorResponse } from "@/lib/api/auth-error";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await verifyStaff();
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || undefined;
    const category = searchParams.get("category") || undefined;
    const status = searchParams.get("status") || undefined;
    const page = searchParams.get("page") ? parseInt(searchParams.get("page")!) : 1;
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!) : 50;

    const service = new WarehouseService();
    const inventory = await service.getWarehouseInventory(id, { search, category, status, page, limit });
    return NextResponse.json(inventory);
  } catch (error: any) {
    return authErrorResponse(error);
  }
}
