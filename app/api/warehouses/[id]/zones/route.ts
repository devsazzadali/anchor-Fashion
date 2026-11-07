import { NextRequest, NextResponse } from "next/server";
import { WarehouseService } from "@/services/warehouse.service";
import { verifyStaff, verifyManager } from "@/lib/security/roles";
import { authErrorResponse } from "@/lib/api/auth-error";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await verifyStaff();
    const { id } = await params;
    const service = new WarehouseService();
    const zones = await service.getZones(id);
    return NextResponse.json(zones);
  } catch (error: any) {
    return authErrorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await verifyManager();
    const { id } = await params;
    const body = await request.json();
    const service = new WarehouseService();
    const zone = await service.createZone({ ...body, warehouse_id: id });
    return NextResponse.json(zone, { status: 201 });
  } catch (error: any) {
    return authErrorResponse(error, 400);
  }
}
