import { NextRequest, NextResponse } from "next/server";
import { ProductRepository } from "@/lib/repositories/catalog/product.repository";

/**
 * Daily cron: permanently delete products that have been in the trash
 * for more than 30 days (Workstream E). Same CRON_SECRET bearer pattern
 * as /api/cron/release-expired-reservations. Registered in vercel.json.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const purged = await ProductRepository.purgeExpiredTrash();
    return NextResponse.json({ success: true, purged });
  } catch (error) {
    console.error("[Cron] purge-product-trash error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
