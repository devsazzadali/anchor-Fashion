import { NextRequest, NextResponse } from "next/server";
import { WarehouseService } from "@/services/warehouse.service";
import type { WarehouseQueryFilters } from "@/repositories/warehouse.repository";
import { verifyStaff, verifyManager } from "@/lib/security/roles";
import { authErrorResponse } from "@/lib/api/auth-error";

export async function GET(request: NextRequest) {
  try {
    await verifyStaff();
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || undefined;
    const status = (searchParams.get("status") as WarehouseQueryFilters["status"]) || undefined;
    const type = searchParams.get("type") || undefined;
    const location = searchParams.get("location") || undefined;
    const sortBy = (searchParams.get("sortBy") as WarehouseQueryFilters["sortBy"]) || undefined;
    const sortOrder = (searchParams.get("sortOrder") as WarehouseQueryFilters["sortOrder"]) || undefined;
    const page = searchParams.get("page") ? parseInt(searchParams.get("page")!) : 1;
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!) : 50;

    const service = new WarehouseService();
    const result = await service.getAllWarehouses({
      search,
      status,
      type,
      location,
      sortBy,
      sortOrder,
      page,
      limit,
    });

    return NextResponse.json(result);
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await verifyManager();
    const body = await request.json();
    const service = new WarehouseService();
    const warehouse = await service.createWarehouse(body);
    return NextResponse.json(warehouse, { status: 201 });
  } catch (error) {
    return authErrorResponse(error, 400);
  }
}
