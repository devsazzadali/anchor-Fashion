import { prisma } from "@/lib/prisma";

export class DashboardRepository {
  async getDailyRevenue(days = 7) {
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - days);

    const rawOrders = await prisma.order.findMany({
      select: { totalAmount: true, status: true, createdAt: true, profileId: true },
      where: { createdAt: { gte: dateLimit } },
      orderBy: { createdAt: "asc" },
    });

    if (rawOrders.length === 0) return [];

    const grouped: Record<
      string,
      { date: string; revenue: number; orders: number; aov: number; newCustomers: number }
    > = {};
    const seenCustomers = new Set<string>();

    for (const ord of rawOrders) {
      const dateStr = ord.createdAt.toISOString().split("T")[0];
      if (!grouped[dateStr]) {
        grouped[dateStr] = { date: dateStr, revenue: 0, orders: 0, aov: 0, newCustomers: 0 };
      }
      grouped[dateStr].orders += 1;
      
      const statusLower = ord.status.toLowerCase();
      if (!["cancelled", "failed", "refunded", "returned"].includes(statusLower)) {
        grouped[dateStr].revenue += Number(ord.totalAmount) || 0;
      }
      if (ord.profileId && !seenCustomers.has(ord.profileId)) {
        seenCustomers.add(ord.profileId);
        grouped[dateStr].newCustomers += 1;
      }
    }

    return Object.values(grouped).map((g) => ({
      date: g.date,
      total_revenue: g.revenue,
      total_orders: g.orders,
      aov: g.orders > 0 ? Math.round(g.revenue / g.orders) : 0,
      new_customers: g.newCustomers,
      returning_customers: 0,
    }));
  }

  async getDashboardKPIs() {
    const [allOrders, profiles] = await Promise.all([
      prisma.order.findMany({
        select: { totalAmount: true, status: true, createdAt: true, profileId: true },
      }),
      // "Customers" must count CUSTOMER-role profiles only — counting every
      // profile also counts admin/manager/staff accounts as customers.
      prisma.profile.findMany({
        where: { role: { name: { equals: "CUSTOMER", mode: "insensitive" } } },
        select: { createdAt: true },
      }),
    ]);
    const totalCustomers = profiles.length;

    const validOrders = allOrders.filter(
      (o) => !["CANCELLED", "FAILED", "REFUNDED", "RETURNED"].includes(o.status.toUpperCase())
    );
    const totalRev = validOrders.reduce(
      (sum, o) => sum + (Number(o.totalAmount) || 0),
      0
    );
    const totalOrdersCount = allOrders.length;
    const avgOrderVal =
      validOrders.length > 0 ? Math.round(totalRev / validOrders.length) : 0;

    // Real period-over-period trends (last 30 days vs the 30 before).
    // These were previously hardcoded (+12.5%, +8.2%, ...) and
    // returningCustomers was fabricated as totalCustomers - 3.
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const inWindow = (d: Date, from: number, to: number) => {
      const t = new Date(d).getTime();
      return t >= from && t < to;
    };
    const trendOf = (curr: number, prev: number) => {
      if (prev === 0) return { value: curr > 0 ? 100 : 0, isPositive: curr >= 0 };
      const v = Number((((curr - prev) / prev) * 100).toFixed(1));
      return { value: Math.abs(v), isPositive: v >= 0 };
    };

    const curFrom = now - 30 * DAY;
    const prevFrom = now - 60 * DAY;
    const revCur = validOrders.filter((o) => inWindow(o.createdAt, curFrom, now + 1)).reduce((s, o) => s + (Number(o.totalAmount) || 0), 0);
    const revPrev = validOrders.filter((o) => inWindow(o.createdAt, prevFrom, curFrom)).reduce((s, o) => s + (Number(o.totalAmount) || 0), 0);
    const ordCur = allOrders.filter((o) => inWindow(o.createdAt, curFrom, now + 1)).length;
    const ordPrev = allOrders.filter((o) => inWindow(o.createdAt, prevFrom, curFrom)).length;
    const validCur = validOrders.filter((o) => inWindow(o.createdAt, curFrom, now + 1));
    const aovCur = validCur.length > 0 ? revCur / validCur.length : 0;
    const validPrev = validOrders.filter((o) => inWindow(o.createdAt, prevFrom, curFrom));
    const aovPrev = validPrev.length > 0 ? revPrev / validPrev.length : 0;
    const custCur = profiles.filter((p) => inWindow(p.createdAt, curFrom, now + 1)).length;
    const custPrev = profiles.filter((p) => inWindow(p.createdAt, prevFrom, curFrom)).length;

    // Returning customers: distinct buyers with at least two valid orders.
    const ordersPerBuyer = new Map<string, number>();
    for (const o of validOrders) {
      if (o.profileId) ordersPerBuyer.set(o.profileId, (ordersPerBuyer.get(o.profileId) || 0) + 1);
    }
    const returningCount = [...ordersPerBuyer.values()].filter((n) => n >= 2).length;
    const buyersCur = new Set(validOrders.filter((o) => inWindow(o.createdAt, curFrom, now + 1)).map((o) => o.profileId).filter(Boolean));
    const repeatBuyersCur = [...buyersCur].filter((id) => (ordersPerBuyer.get(id as string) || 0) >= 2).length;
    const buyersPrev = new Set(validPrev.map((o) => o.profileId).filter(Boolean));
    const repeatBuyersPrev = [...buyersPrev].filter((id) => (ordersPerBuyer.get(id as string) || 0) >= 2).length;

    // REG-35: "Today's Orders" must mean orders placed TODAY in the
    // store's timezone (Asia/Dhaka, fixed UTC+6, no DST) — the manager
    // dashboard previously displayed the ALL-TIME order count under
    // that label. Trend is today vs yesterday (Dhaka), matching the
    // card's meaning.
    const dhakaDateStr = (d: Date) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Dhaka",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(d);
    const todayStartUtc = Date.parse(`${dhakaDateStr(new Date())}T00:00:00+06:00`);
    const tomorrowStartUtc = todayStartUtc + DAY;
    const yesterdayStartUtc = todayStartUtc - DAY;
    const todaysOrdersCount = allOrders.filter((o) =>
      inWindow(o.createdAt, todayStartUtc, tomorrowStartUtc)
    ).length;
    const yesterdaysOrdersCount = allOrders.filter((o) =>
      inWindow(o.createdAt, yesterdayStartUtc, todayStartUtc)
    ).length;

    // REG-35: delivered ("completed") = DELIVERED + COMPLETED, the
    // same bucket the admin surfaces label "Delivered" (REG-22).
    const deliveredOrdersCount = allOrders.filter((o) =>
      ["DELIVERED", "COMPLETED"].includes(o.status.toUpperCase())
    ).length;

    return {
      revenue: {
        value: totalRev,
        trend: trendOf(revCur, revPrev),
      },
      orders: {
        value: totalOrdersCount,
        trend: trendOf(ordCur, ordPrev),
      },
      todaysOrders: {
        value: todaysOrdersCount,
        trend: trendOf(todaysOrdersCount, yesterdaysOrdersCount),
      },
      validOrdersCount: validOrders.length,
      deliveredOrdersCount,
      aov: {
        value: avgOrderVal,
        trend: trendOf(aovCur, aovPrev),
      },
      newCustomers: {
        value: totalCustomers,
        trend: trendOf(custCur, custPrev),
      },
      returningCustomers: {
        value: returningCount,
        trend: trendOf(repeatBuyersCur, repeatBuyersPrev),
      },
    };
  }

  async getOperationalMetrics() {
    const [orderCounts, inventoryLevels, supportTicketsCount] = await Promise.all([
      prisma.order.groupBy({
        by: ["status"],
        _count: { status: true },
      }),
      prisma.inventoryLevel.findMany({
        select: { quantityAvailable: true, reorderPoint: true },
      }),
      prisma.supportTicket.count({
        where: { status: { in: ["open", "pending", "OPEN", "PENDING"] } },
      }),
    ]);

    const statusCounts = orderCounts.reduce((acc, curr) => {
      acc[curr.status.toUpperCase()] = curr._count.status;
      return acc;
    }, {} as Record<string, number>);

    const outOfStock = inventoryLevels.filter((i) => i.quantityAvailable <= 0).length;
    const lowStock = inventoryLevels.filter(
      (i) => i.quantityAvailable > 0 && i.quantityAvailable <= (i.reorderPoint || 0)
    ).length;

    // REG-35: "Processing" = orders currently in a processing state
    // (confirmed → ready for shipment). It previously counted only
    // PENDING_PAYMENT + PREPARING (showing 1 while 14 orders were in
    // processing states). "Completed" previously added SHIPPED —
    // in-transit is not completed; completed = DELIVERED + COMPLETED.
    const PROCESSING_STATES = [
      "CONFIRMED",
      "PREPARING",
      "PROCESSING",
      "PICKING",
      "PACKING",
      "READY_FOR_SHIPMENT",
    ];
    const processingOrders = PROCESSING_STATES.reduce(
      (sum, s) => sum + (statusCounts[s] || 0),
      0
    );

    return {
      pendingOrders: (statusCounts["PENDING_PAYMENT"] || 0) + (statusCounts["PREPARING"] || 0),
      processingOrders,
      completedOrders:
        (statusCounts["DELIVERED"] || 0) + (statusCounts["COMPLETED"] || 0),
      cancelledOrders: statusCounts["CANCELLED"] || 0,
      refundRequests: statusCounts["REFUNDED"] || 0,
      lowStock,
      outOfStock,
      supportTickets: supportTicketsCount,
    };
  }

  async getTopSellers() {
    const orderItems = await prisma.orderItem.findMany({
      select: { productId: true, productName: true, unitPrice: true, quantity: true, totalPrice: true },
    });

    const statsByProduct: Record<
      string,
      { product_id: string; product_name: string; sold: number; earnings: number; price: number }
    > = {};

    for (const item of orderItems) {
      if (!item.productId) continue;
      const pid = item.productId;
      if (!statsByProduct[pid]) {
        statsByProduct[pid] = {
          product_id: pid,
          product_name: item.productName || "Unknown Product",
          sold: 0,
          earnings: 0,
          price: Number(item.unitPrice) || 0,
        };
      }
      statsByProduct[pid].sold += Number(item.quantity) || 1;
      statsByProduct[pid].earnings += Number(item.totalPrice) || 0;
    }

    const sortedSales = Object.values(statsByProduct)
      .sort((a, b) => b.sold - a.sold)
      .slice(0, 5);

    if (sortedSales.length === 0) {
      // Fallback
      const products = await prisma.product.findMany({
        where: { status: "ACTIVE" },
        take: 5,
        include: { category: { select: { name: true } } }
      });
      return products.map(p => ({
        product_id: p.id,
        product_name: p.name,
        category_name: p.category?.name || "Apparel",
        price: Number(p.basePrice) || 0,
        sold: 0,
        earnings: 0,
        image_url: p.imageUrl,
      }));
    }

    const pIds = sortedSales.map(s => s.product_id);
    const products = await prisma.product.findMany({
      where: { id: { in: pIds } },
      include: { category: { select: { name: true } } }
    });

    const pMap = new Map(products.map(p => [p.id, p]));

    return sortedSales.map(sale => {
      const prod = pMap.get(sale.product_id);
      return {
        product_id: sale.product_id,
        product_name: sale.product_name,
        category_name: prod?.category?.name || "Apparel",
        price: sale.price || Number(prod?.basePrice) || 0,
        sold: sale.sold,
        earnings: sale.earnings,
        image_url: prod?.imageUrl || null,
      };
    });
  }

  async getRevenueByCategory() {
    const defaultCategories = ["Dresses", "Tops", "Coats & Jackets", "Jumpsuits", "Jeans"];
    const categoryRev: Record<string, number> = {};
    for (const cat of defaultCategories) {
      categoryRev[cat] = 0;
    }

    // REG-84 (Round 19): per-product revenue sums now come from the
    // database (one groupBy) instead of fetching every order item and
    // summing in JS. The presentation — seeded default categories, the
    // "Apparel" fallback for missing/deleted products and null
    // productIds, sort + top-5 — is unchanged. Equivalence against the
    // old implementation was proven byte-identical over the full
    // production dataset (40 items; Round-19 equivalence harness).
    const grouped = await prisma.orderItem.groupBy({
      by: ["productId"],
      _sum: { totalPrice: true },
    });

    if (grouped.length > 0) {
      const pIds = [...new Set(grouped.map(g => g.productId).filter((id): id is string => Boolean(id)))];
      const products = await prisma.product.findMany({
        where: { id: { in: pIds } },
        select: { id: true, category: { select: { name: true } } }
      });
      const pMap = new Map(products.map(p => [p.id, p.category?.name || "Apparel"]));

      for (const g of grouped) {
        const catName = (g.productId ? pMap.get(g.productId) : null) || "Apparel";
        categoryRev[catName] = (categoryRev[catName] || 0) + Number(g._sum.totalPrice || 0);
      }
    }

    return Object.entries(categoryRev)
      .map(([category_name, total_revenue]) => ({
        category_name,
        total_revenue,
      }))
      .sort((a, b) => b.total_revenue - a.total_revenue)
      .slice(0, 5);
  }

  async getRecentCustomers() {
    const latestOrders = await prisma.order.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      select: { id: true, profileId: true, status: true, createdAt: true, profile: { select: { firstName: true, lastName: true, email: true, avatarUrl: true } } }
    });

    return latestOrders.map((ord: any) => {
      const prof = ord.profile;
      const fullName = prof?.firstName || prof?.lastName
        ? `${prof.firstName || ""} ${prof.lastName || ""}`.trim()
        : prof?.email?.split("@")[0] || "Customer";

      return {
        user_id: ord.profileId || ord.id,
        full_name: fullName,
        avatar_url: prof?.avatarUrl || null,
        latest_order_id: ord.id,
        latest_order_status: ord.status,
        last_order_date: ord.createdAt.toISOString(),
      };
    });
  }

  async getUserLocations() {
    // Real distribution from order shipping addresses. This used to split
    // the profile count 55/25/20 across Dhaka/Chittagong/Sylhet by fiat.
    const orders = await prisma.order.findMany({
      select: { shippingAddress: true },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });

    const counts = new Map<string, number>();
    for (const o of orders) {
      const addr = (o.shippingAddress || {}) as Record<string, any>;
      const city = String(addr.city || addr.district || "").trim();
      if (!city) continue;
      counts.set(city, (counts.get(city) || 0) + 1);
    }

    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([city, count]) => ({ country: city, user_count: count }));
  }

  async getDealOfTheDay() {
    const prod = await prisma.product.findFirst({
      where: { tags: { has: "Featured" } },
      select: { id: true, name: true, basePrice: true, imageUrl: true }
    });

    if (prod) {
      return { ...prod, image_url: prod.imageUrl };
    }

    return null;
  }

  async getRecentOrders() {
    const prismaOrders = await prisma.order.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      include: { profile: true },
    });

    return prismaOrders.map((o) => {
      let customerName = "Customer";
      const customerAvatar: string | null = o.profile?.avatarUrl || null;

      if (o.profile?.firstName || o.profile?.lastName) {
        customerName = [o.profile.firstName, o.profile.lastName].filter(Boolean).join(" ").trim();
      } else if (o.shippingAddress && typeof o.shippingAddress === "object") {
        const addr = o.shippingAddress as Record<string, any>;
        customerName = [addr.first_name || addr.firstName, addr.last_name || addr.lastName]
          .filter(Boolean)
          .join(" ")
          .trim();
      } else if (o.profile?.email) {
        customerName = o.profile.email.split("@")[0];
      }

      return {
        id: o.id,
        order_number: o.orderNumber,
        customer_name: customerName || "Customer",
        customer_avatar: customerAvatar,
        grand_total: Number(o.totalAmount || 0),
        status: o.status,
        created_at: o.createdAt.toISOString(),
      };
    });
  }
}
