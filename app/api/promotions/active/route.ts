import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const now = new Date();
    // Only promotions inside their active window are eligible. The
    // previous query ignored start/end dates entirely, so an expired
    // promotion (e.g. the most recently edited one) was shown to
    // customers as if it were live.
    const activePromotion = await prisma.promotions.findFirst({
      where: {
        is_active: true,
        AND: [
          { OR: [{ start_date: null }, { start_date: { lte: now } }] },
          { OR: [{ end_date: null }, { end_date: { gte: now } }] },
        ],
      },
      orderBy: {
        updated_at: "desc",
      },
    });

    if (!activePromotion) {
      return NextResponse.json({ promotion: null });
    }

    return NextResponse.json({
      promotion: {
        id: activePromotion.id,
        title: activePromotion.title,
        description: activePromotion.description,
        code: activePromotion.code,
        type: activePromotion.type,
        value: activePromotion.value ? Number(activePromotion.value) : null,
        isActive: activePromotion.is_active,
      },
    });
  } catch (error) {
    // Never invent a promotion on failure. The previous handler returned a
    // fabricated "ANCHORVIP15 — 15% off" offer with HTTP 200 on ANY error,
    // sending customers to checkout with a code that does not exist.
    console.error("[API_ACTIVE_PROMOTION_ERROR]", error);
    return NextResponse.json({ promotion: null }, { status: 200 });
  }
}
