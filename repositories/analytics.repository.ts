import { createAdminDbClient } from "@/lib/db/client";

export type DateRange = {
  from: Date;
  to: Date;
};

export class AnalyticsRepository {
  /**
   * Executive Dashboard Data
   */
  static async getExecutiveSummary(dateRange?: DateRange) {
    const db = await createAdminDbClient();

    let periodDays = 30;
    let currentFrom = new Date();
    currentFrom.setDate(currentFrom.getDate() - 30);
    let currentTo = new Date();
    
    if (dateRange) {
      currentFrom = dateRange.from;
      currentTo = dateRange.to;
      periodDays = Math.max(1, Math.round((currentTo.getTime() - currentFrom.getTime()) / (1000 * 60 * 60 * 24)));
    }

    const previousFrom = new Date(currentFrom);
    previousFrom.setDate(previousFrom.getDate() - periodDays);
    
    // Revenue and Orders: Calculated directly from orders table
    const { data: orders } = await db
      .from("orders")
      .select("id, grand_total, status, created_at");

    // Customers from customers table
    const { data: allCustomers } = await db
      .from("customers")
      .select("id, created_at, status")
      .gte("created_at", previousFrom.toISOString())
      .lte("created_at", currentTo.toISOString());

    const customers = allCustomers?.filter((c: any) => new Date(c.created_at) >= currentFrom) || [];
    const previousCustomers = allCustomers?.filter((c: any) => new Date(c.created_at) >= previousFrom && new Date(c.created_at) < currentFrom) || [];

    // Products
    const { count: productsCount } = await db
      .from("products")
      .select("*", { count: "exact", head: true });

    // Inventory Value (valued at cost below, via variant → product cost)
    const { data: inventory } = await db
      .from("inventory_levels")
      .select("quantity_available, variant_id");
    const { data: variantProducts } = await db
      .from("variants")
      .select("id, product_id");
    const productByVariant = new Map<string, string>(
      (variantProducts || []).map((v: any) => [String(v.id), String(v.product_id)] as [string, string])
    );

    // ── Real profit basis ────────────────────────────────────────────────
    // Gross profit is Σ (unit_price − product cost_price) × quantity over
    // the period's orders. This replaces three fabrications: profit =
    // revenue × 0.35, net profit = gross × 0.8, inventory = units × $50.
    const { data: orderItems } = await db
      .from("order_items")
      .select("order_id, product_id, quantity, unit_price");
    const { data: productCosts } = await db
      .from("products")
      .select("id, cost_price");
    const costByProduct = new Map<string, number>(
      (productCosts || []).map((p: any) => [String(p.id), Number(p.cost_price) || 0] as [string, number])
    );
    const profitByOrder = new Map<string, number>();
    for (const it of (orderItems || []) as any[]) {
      if (!it.product_id) continue;
      const margin =
        (Number(it.unit_price) || 0) - (costByProduct.get(it.product_id) || 0);
      profitByOrder.set(
        it.order_id,
        (profitByOrder.get(it.order_id) || 0) + margin * (Number(it.quantity) || 0)
      );
    }
    const { data: periodExpenses } = await db
      .from("expenses")
      .select("amount, date")
      .gte("date", currentFrom.toISOString().split("T")[0])
      .lte("date", currentTo.toISOString().split("T")[0]);
    const expensesTotal = (periodExpenses || []).reduce(
      (s: number, e: any) => s + (Number(e.amount) || 0),
      0
    );

    let totalRevenue = 0;
    let totalOrders = 0;
    let totalProfit = 0;

    let prevTotalRevenue = 0;
    let prevTotalOrders = 0;

    const now = new Date();
    const todayStr = now.toISOString().split("T")[0];

    const weekAgo = new Date();
    weekAgo.setDate(now.getDate() - 7);

    const monthAgo = new Date();
    monthAgo.setMonth(now.getMonth() - 1);

    const yearAgo = new Date();
    yearAgo.setFullYear(now.getFullYear() - 1);

    let todaysRevenue = 0;
    let weeklyRevenue = 0;
    let monthlyRevenue = 0;
    let yearlyRevenue = 0;

    if (orders && orders.length > 0) {
      orders.forEach((o: any) => {
        const s = (o.status || "").toLowerCase();
        if (s !== "cancelled" && s !== "returned") {
          const createdAt = new Date(o.created_at);
          const createdAtStr = createdAt.toISOString().split("T")[0];
          const isCurrent = createdAt >= currentFrom && createdAt <= currentTo;
          const isPrevious = createdAt >= previousFrom && createdAt < currentFrom;
          const amount = Number(o.grand_total ?? o.total_amount) || 0;

          if (isCurrent) {
            totalRevenue += amount;
            totalOrders++;
            totalProfit += profitByOrder.get(o.id) || 0;

            if (createdAtStr === todayStr) todaysRevenue += amount;
            if (createdAt >= weekAgo) weeklyRevenue += amount;
            if (createdAt >= monthAgo) monthlyRevenue += amount;
            if (createdAt >= yearAgo) yearlyRevenue += amount;
          } else if (isPrevious) {
            prevTotalRevenue += amount;
            prevTotalOrders++;
          }
        }
      });
    }

    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    const prevAverageOrderValue = prevTotalOrders > 0 ? prevTotalRevenue / prevTotalOrders : 0;
    
    const totalCustomers = customers?.length || 0;
    const prevTotalCustomers = previousCustomers?.length || 0;
    
    const ordersPerCustomerVal = totalCustomers > 0 ? totalOrders / totalCustomers : 0;
    const prevOrdersPerCustomer = prevTotalCustomers > 0 ? prevTotalOrders / prevTotalCustomers : 0;
    
    // Instead of using 'status', we calculate active customers as those who made an order in the current period
    const { data: recentOrders } = await db
      .from("orders")
      .select("customer_id")
      .gte("created_at", currentFrom.toISOString());
      
    const activeCustomers = new Set(recentOrders?.map((o: any) => o.customer_id).filter(Boolean)).size || 0;

    // Inventory valued at cost: Σ quantity_available × product cost_price.
    const totalInventoryValue = (inventory || []).reduce(
      (sum: number, item: any) =>
        sum +
        (Number(item.quantity_available) || 0) *
          (costByProduct.get(productByVariant.get(String(item.variant_id)) || "") || 0),
      0
    );

    const grossProfit = totalProfit;
    // Net profit = gross profit − operating expenses recorded in the period.
    const netProfit = grossProfit - expensesTotal;

    const calcTrend = (curr: number, prev: number) => {
      if (prev === 0) return curr > 0 ? 100 : 0;
      return Number((((curr - prev) / prev) * 100).toFixed(1));
    };

    const revenueByDay: Record<string, number> = {};
    if (orders && orders.length > 0) {
      orders.forEach((o: any) => {
        const s = (o.status || "").toLowerCase();
        if (s !== "cancelled" && s !== "returned" && o.created_at) {
          const d = new Date(o.created_at).toISOString().split("T")[0];
          revenueByDay[d] = (revenueByDay[d] || 0) + (Number(o.grand_total ?? o.total_amount) || 0);
        }
      });
    }
    const revenueHistoryData = Object.entries(revenueByDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, total]) => ({ name, total }));

    return {
      totalRevenue,
      revenueTrend: calcTrend(totalRevenue, prevTotalRevenue),
      todaysRevenue,
      weeklyRevenue,
      monthlyRevenue,
      yearlyRevenue,
      grossProfit,
      netProfit,
      totalOrders,
      ordersTrend: calcTrend(totalOrders, prevTotalOrders),
      totalCustomers,
      customersTrend: calcTrend(totalCustomers, prevTotalCustomers),
      activeCustomers,
      productsCount: productsCount || 0,
      averageOrderValue,
      aovTrend: calcTrend(averageOrderValue, prevAverageOrderValue),
      ordersPerCustomer: Number(ordersPerCustomerVal.toFixed(1)),
      opcTrend: calcTrend(ordersPerCustomerVal, prevOrdersPerCustomer),
      inventoryValue: totalInventoryValue,
      revenueHistory: revenueHistoryData,
    };
  }

  /**
   * Sales Analytics
   */
  static async getSalesAnalytics(dateRange?: DateRange) {
    const db = await createAdminDbClient();

    let fromDate: Date | null = null;
    let toDate: Date | null = null;

    if (dateRange) {
      fromDate = new Date(dateRange.from);
      fromDate.setHours(0, 0, 0, 0);
      toDate = new Date(dateRange.to);
      toDate.setHours(23, 59, 59, 999);
    }

    // Query real orders
    let ordersQuery = db
      .from("orders")
      .select(
        "id, order_number, grand_total, subtotal, shipping_total, discount_total, tax_total, payment_method, payment_status, status, created_at, customer_id"
      )
      .order("created_at", { ascending: true });

    if (fromDate && toDate) {
      ordersQuery = ordersQuery
        .gte("created_at", fromDate.toISOString())
        .lte("created_at", toDate.toISOString());
    }

    const { data: rawOrders, error: ordersError } = await ordersQuery;
    if (ordersError) {
      console.error("Error fetching orders for sales analytics:", ordersError);
    }

    const orders = rawOrders || [];

    // Filter valid non-cancelled orders for sales calculation
    const validOrders = orders.filter((o: any) => {
      const s = (o.status || "").toLowerCase();
      return s !== "cancelled" && s !== "returned";
    });

    const validOrderIds = new Set(validOrders.map((o: any) => o.id));

    // Daily sales trend
    const salesByDate: Record<string, { revenue: number; ordersCount: number }> = {};
    validOrders.forEach((order: any) => {
      const date = new Date(order.created_at).toISOString().split("T")[0];
      if (!salesByDate[date]) {
        salesByDate[date] = { revenue: 0, ordersCount: 0 };
      }
      salesByDate[date].revenue += Number(order.grand_total ?? order.total_amount) || 0;
      salesByDate[date].ordersCount += 1;
    });

    const dailySales = Object.keys(salesByDate)
      .sort()
      .map((date) => ({
        date,
        revenue: Math.round(salesByDate[date].revenue * 100) / 100,
        orders: salesByDate[date].ordersCount,
      }));

    // Payment methods breakdown
    const paymentMethods: Record<string, number> = {};
    validOrders.forEach((order: any) => {
      let pm = (order.payment_method || "Other").toUpperCase();
      if (pm === "COD") pm = "Cash on Delivery";
      else if (pm === "BKASH") pm = "bKash";
      else if (pm === "SSLCOMMERZ") pm = "SSLCOMMERZ";
      else if (pm === "NAGAD") pm = "Nagad";

      paymentMethods[pm] =
        (paymentMethods[pm] || 0) + (Number(order.grand_total ?? order.total_amount) || 0);
    });

    // Shipping methods breakdown
    const shippingMethods: Record<string, number> = {};
    validOrders.forEach((order: any) => {
      const st = Number(order.shipping_total ?? order.shipping_fee) || 0;
      let sm = "Standard Delivery";
      if (st === 0) sm = "Free Shipping";
      else if (st === 60) sm = "Inside Dhaka";
      else if (st === 120) sm = "Express Dhaka";
      else if (st === 150) sm = "Outside Dhaka";
      else sm = `Standard (৳${st})`;

      shippingMethods[sm] =
        (shippingMethods[sm] || 0) + (Number(order.grand_total ?? order.total_amount) || 0);
    });

    // Also fetch items, products & addresses to get Category breakdown, Top selling products & customer names
    const [itemsRes, productsRes, addressesRes] = await Promise.all([
      db
        .from("order_items")
        .select("id, order_id, product_id, product_name, quantity, line_total"),
      db
        .from("products")
        .select("id, name, category_id, categories(name)"),
      db
        .from("order_addresses")
        .select("order_id, first_name, last_name, city, address_type"),
    ]);

    const productMap = new Map<string, any>((productsRes.data || []).map((p: any) => [p.id, p]));
    const categoryTotals: Record<string, number> = {};
    const productSalesMap: Record<string, { name: string; quantity: number; revenue: number }> = {};

    (itemsRes.data || []).forEach((item: any) => {
      if (item.order_id && validOrderIds.has(item.order_id)) {
        const prod: any = productMap.get(item.product_id);
        const catName = prod?.categories?.name || "Apparel";
        const lineTotal = Number(item.line_total) || 0;
        const qty = Number(item.quantity) || 1;

        categoryTotals[catName] = (categoryTotals[catName] || 0) + lineTotal;

        const prodName = item.product_name || prod?.name || "Product";
        if (!productSalesMap[prodName]) {
          productSalesMap[prodName] = { name: prodName, quantity: 0, revenue: 0 };
        }
        productSalesMap[prodName].quantity += qty;
        productSalesMap[prodName].revenue += lineTotal;
      }
    });

    const categorySales = Object.entries(categoryTotals)
      .map(([name, value]) => ({
        name,
        value: Math.round(value * 100) / 100,
      }))
      .sort((a, b) => b.value - a.value);

    const topSellingProducts = Object.values(productSalesMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)
      .map((p) => ({
        name: p.name,
        quantity: p.quantity,
        revenue: Math.round(p.revenue * 100) / 100,
      }));

    // Customer mapping for recent orders
    const addressMap = new Map<string, string>();
    (addressesRes.data || []).forEach((addr: any) => {
      if (addr.order_id && (addr.first_name || addr.last_name)) {
        addressMap.set(
          addr.order_id,
          `${addr.first_name || ""} ${addr.last_name || ""}`.trim()
        );
      }
    });

    const recentOrders = validOrders.slice(-8).reverse().map((order: any) => {
      const customerName =
        addressMap.get(order.id) || "Valued Customer";

      return {
        id: order.id,
        orderNumber: order.order_number,
        customerName,
        amount: Number(order.grand_total ?? order.total_amount) || 0,
        status: order.status,
        paymentMethod: order.payment_method || "COD",
        paymentStatus: order.payment_status || "PENDING",
        createdAt: order.created_at,
      };
    });

    const totalSales =
      Math.round(
        validOrders.reduce(
          (sum: number, o: any) => sum + (Number(o.grand_total ?? o.total_amount) || 0),
          0
        ) * 100
      ) / 100;
    const totalOrdersCount = validOrders.length;
    const averageOrderValue =
      totalOrdersCount > 0
        ? Math.round((totalSales / totalOrdersCount) * 100) / 100
        : 0;
    // REG-28: honest order counts. Previously cancelledOrdersCount was
    // ALL − valid, silently folding RETURNED orders into "cancelled",
    // and the page's "Total Orders" card displayed the VALID count.
    // Expose each population under its own name; `totalOrders` in the
    // return below is now the ALL-orders count its label claims.
    const cancelledOrdersCount = orders.filter(
      (o: any) => (o.status || "").toLowerCase() === "cancelled"
    ).length;
    const returnedOrdersCount = orders.filter(
      (o: any) => (o.status || "").toLowerCase() === "returned"
    ).length;
    const allOrdersCount = orders.length;

    return {
      dailySales,
      paymentMethodSales: Object.entries(paymentMethods).map(([name, value]) => ({
        name,
        value: Math.round(value * 100) / 100,
      })),
      shippingMethodSales: Object.entries(shippingMethods).map(([name, value]) => ({
        name,
        value: Math.round(value * 100) / 100,
      })),
      categorySales,
      topSellingProducts,
      recentOrders,
      totalSales,
      // REG-28: totalOrders = ALL orders in range (what the "Total
      // Orders" label always claimed); the valid-only count travels
      // under its own name for the sales/AOV context.
      totalOrders: allOrdersCount,
      validOrdersCount: totalOrdersCount,
      allOrdersCount,
      averageOrderValue,
      cancelledOrdersCount,
      returnedOrdersCount,
    };
  }

  /**
   * Order Analytics
   */
  static async getOrderAnalytics(dateRange?: DateRange) {
    const db = await createAdminDbClient();
    let ordersQuery = db
      .from("orders")
      .select("id, status, created_at, grand_total");

    if (dateRange) {
      ordersQuery = ordersQuery
        .gte("created_at", dateRange.from.toISOString())
        .lte("created_at", dateRange.to.toISOString());
    }

    const { data: orders } = await ordersQuery;

    const statusCounts: Record<string, number> = {
      pending: 0,
      processing: 0,
      packed: 0,
      shipped: 0,
      delivered: 0,
      returned: 0,
      cancelled: 0,
    };

    let totalRefunds = 0;
    let refundedOrdersCount = 0;

    orders?.forEach((order: any) => {
      const normalizedStatus = order.status?.toLowerCase() || "pending";
      if (statusCounts[normalizedStatus] !== undefined) {
        statusCounts[normalizedStatus]++;
      } else {
        statusCounts[normalizedStatus] = 1;
      }

      if (normalizedStatus === "returned" || normalizedStatus === "cancelled") {
        totalRefunds += Number(order.grand_total ?? order.total_amount) || 0;
        refundedOrdersCount++;
      }
    });

    const statuses = Object.keys(statusCounts).map((name) => ({
      name,
      value: statusCounts[name],
    }));

    return {
      statuses,
      statusCounts,
      refundStatistics: {
        totalAmount: totalRefunds,
        count: refundedOrdersCount,
        rate: orders?.length ? (refundedOrdersCount / orders.length) * 100 : 0,
      },
      total: orders?.length || 0,
    };
  }

  /**
   * Customer Analytics
   */
  static async getCustomerAnalytics(dateRange?: DateRange) {
    const db = await createAdminDbClient();

    let customersQuery = db
      .from("customer_profiles")
      .select("id, created_at");
    if (dateRange) {
      customersQuery = customersQuery
        .gte("created_at", dateRange.from.toISOString())
        .lte("created_at", dateRange.to.toISOString());
    }

    const { data: customers } = await customersQuery;
    const { data: orders } = await db
      .from("orders")
      .select("customer_id, grand_total");

    const customerGrowthByDate: Record<string, number> = {};
    customers?.forEach((c: any) => {
      const date = new Date(c.created_at).toISOString().split("T")[0];
      customerGrowthByDate[date] = (customerGrowthByDate[date] || 0) + 1;
    });

    const customerGrowth = Object.keys(customerGrowthByDate)
      .map((date) => ({
        date,
        customers: customerGrowthByDate[date],
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Lifetime Value and Top Customers
    const customerSpend: Record<string, number> = {};
    const orderCount: Record<string, number> = {};

    orders?.forEach((o: any) => {
      if (o.customer_id) {
        customerSpend[o.customer_id] =
          (customerSpend[o.customer_id] || 0) + (Number(o.grand_total ?? o.total_amount) || 0);
        orderCount[o.customer_id] = (orderCount[o.customer_id] || 0) + 1;
      }
    });

    let returningCustomers = 0;
    let newCustomers = 0;

    Object.values(orderCount).forEach((count) => {
      if (count > 1) returningCustomers++;
      else newCustomers++;
    });

    const averageLTV =
      Object.values(customerSpend).length > 0
        ? Object.values(customerSpend).reduce((a, b) => a + b, 0) /
          Object.values(customerSpend).length
        : 0;

    return {
      totalCustomers: customers?.length || 0,
      newCustomers,
      returningCustomers,
      customerGrowth,
      averageLifetimeValue: averageLTV,
      customerSegments: [
        { name: "New (1 order)", value: newCustomers },
        { name: "Returning (>1 order)", value: returningCustomers },
      ],
    };
  }

  /**
   * Product & Inventory Analytics
   */
  static async getProductAnalytics() {
    const db = await createAdminDbClient();

    // Query inventory, products, orders, and order items concurrently
    const [invRes, productsRes, itemsRes, ordersRes] = await Promise.all([
      db
        .from("inventory_levels")
        .select("variant_id, quantity_available, reorder_point"),
      db
        .from("products")
        .select("id, name, created_at"),
      db
        .from("order_items")
        .select("id, order_id, product_id, product_name, quantity, unit_price, line_total"),
      db
        .from("orders")
        .select("id, status"),
    ]);

    const inventory = invRes.data || [];
    const products = productsRes.data || [];
    const orderItems = itemsRes.data || [];
    const orders = ordersRes.data || [];

    let outOfStock = 0;
    let lowStock = 0;
    let inStock = 0;

    inventory.forEach((item: any) => {
      if ((item.quantity_available || 0) <= 0) outOfStock++;
      else if ((item.quantity_available || 0) <= (item.reorder_point || 5)) lowStock++;
      else inStock++;
    });

    // Valid non-cancelled orders filter
    const validOrderIds = new Set(
      orders
        .filter((o: any) => {
          const s = (o.status || "").toLowerCase();
          return s !== "cancelled" && s !== "returned";
        })
        .map((o: any) => o.id)
    );

    const productMap = new Map(products.map((prod: any) => [prod.id, prod.name]));

    // Aggregate Best Sellers & Sales by Product
    const productSales: Record<
      string,
      { id: string; name: string; quantitySold: number; revenue: number }
    > = {};

    orderItems.forEach((item: any) => {
      // If order_id exists, only include non-cancelled orders
      if (item.order_id && !validOrderIds.has(item.order_id)) return;

      const key = item.product_id || item.product_name || item.id;
      const name =
        (item.product_id && productMap.get(item.product_id)) ||
        item.product_name ||
        "Product";

      if (!productSales[key]) {
        productSales[key] = {
          id: key,
          name,
          quantitySold: 0,
          revenue: 0,
        };
      }

      const qty = Number(item.quantity) || 1;
      const rev =
        Number(item.line_total) ||
        qty * (Number(item.unit_price) || 0);

      productSales[key].quantitySold += qty;
      productSales[key].revenue += rev;
    });

    // Best Sellers sorted primarily by Revenue (Highest revenue generating products), then Qty Sold
    const salesArray = Object.values(productSales).sort(
      (a, b) => b.revenue - a.revenue || b.quantitySold - a.quantitySold
    );

    // Worst Sellers (products with lowest sales)
    const worstSellers = [...salesArray].reverse().slice(0, 10);

    // Most active products (or newly added products as traffic proxy)
    const mostViewed = products
      .slice(0, 10)
      .map((p: any) => ({
        id: p.id,
        name: p.name,
        views: 0,
      }));

    return {
      stockLevels: [
        { name: "In Stock", value: inStock },
        { name: "Low Stock", value: lowStock },
        { name: "Out of Stock", value: outOfStock },
      ],
      lowStockProducts: lowStock,
      outOfStockProducts: outOfStock,
      totalItems: inventory.length || 0,
      bestSellers: salesArray.slice(0, 10),
      worstSellers: worstSellers,
      mostViewedProducts: mostViewed,
    };
  }

  /**
   * Marketing Analytics
   */
  static async getMarketingAnalytics(dateRange?: DateRange) {
    const db = await createAdminDbClient();

    let couponsQuery = db
      .from("coupon_usages")
      .select("discount_applied, created_at, code");
    if (dateRange) {
      couponsQuery = couponsQuery
        .gte("created_at", dateRange.from.toISOString())
        .lte("created_at", dateRange.to.toISOString());
    }
    const { data: coupons } = await couponsQuery;

    const { data: customers } = await db
      .from("customer_profiles")
      .select("accepts_marketing");

    const totalDiscountGiven =
      coupons?.reduce((acc: number, c: any) => acc + (c.discount_applied || 0), 0) || 0;

    const newsletterSubscribers =
      customers?.filter((c: any) => c.accepts_marketing).length || 0;

    const couponUsageStats: Record<string, number> = {};
    coupons?.forEach((c: any) => {
      if (c.code) {
        couponUsageStats[c.code] = (couponUsageStats[c.code] || 0) + 1;
      }
    });

    const topCoupons = Object.keys(couponUsageStats)
      .map((code) => ({
        code,
        uses: couponUsageStats[code],
      }))
      .sort((a, b) => b.uses - a.uses)
      .slice(0, 5);

    return {
      couponsUsed: coupons?.length || 0,
      totalDiscountGiven,
      newsletterSubscribers,
      topCoupons,
    };
  }

  /**
   * Alias for Inventory Analytics
   */
  static async getInventoryAnalytics() {
    return this.getProductAnalytics();
  }
}
