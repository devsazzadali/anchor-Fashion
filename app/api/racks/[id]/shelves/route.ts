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
    // id can be formatted as zoneId-rackCode or rackId
    const parts = id.split("-");
    const zoneId = parts[0];
    const rackCode = parts.slice(1).join("-");

    const service = new WarehouseService();
    const bins = await service.getBins(zoneId);
    const filtered = rackCode ? bins.filter((b) => b.code.startsWith(rackCode)) : bins;
    return NextResponse.json(filtered);
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
    const parts = id.split("-");
    const zoneId = parts[0];
    const body = await request.json();

    const service = new WarehouseService();
    const bin = await service.createBin({ ...body, zone_id: zoneId });
    return NextResponse.json(bin, { status: 201 });
  } catch (error: any) {
    return authErrorResponse(error, 400);
  }
}
