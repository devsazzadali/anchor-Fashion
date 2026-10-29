import { createDbClient } from "@/lib/db/client";

export async function getExecutiveKpis() {
  const db = await createDbClient();

  // Computed directly from orders + order_items. The previous version read
  // a bi_sales_mart table that does not exist in this database and carried
  // hardcoded "mock" trends (12.5 / 8.2 / -1.5 / 14.1).
  const { data: orders, error } = await db
    .from("orders")
    .select("id, grand_total, total_amount, status, created_at")
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error || !orders) {
    if (error) console.error("Error fetching sales KPIs:", error);
    return null;
  }

  const { data: items } = await db
    .from("order_items")
    .select("order_id, product_id, quantity, unit_price");
  const { data: products } = await db
    .from("products")
    .select("id, cost_price");
  const costByProduct = new Map<string, number>(
    (products || []).map((p: any) => [String(p.id), Number(p.cost_price) || 0] as [string, number])
  );
  const profitByOrder = new Map<string, number>();
  for (const it of (items || []) as any[]) {
    if (!it.product_id) continue;
    const margin =
      (Number(it.unit_price) || 0) - (costByProduct.get(it.product_id) || 0);
    profitByOrder.set(
      it.order_id,
      (profitByOrder.get(it.order_id) || 0) + margin * (Number(it.quantity) || 0)
    );
  }

  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const aggregate = (from: number, to: number) => {
    let revenue = 0;
    let count = 0;
    let profit = 0;
    for (const o of orders) {
      const s = (o.status || "").toLowerCase();
      if (s === "cancelled" || s === "returned" || s === "failed" || s === "refunded") continue;
      const t = new Date(o.created_at).getTime();
      if (t < from || t >= to) continue;
      revenue += Number(o.grand_total ?? o.total_amount) || 0;
      count++;
      profit += profitByOrder.get(o.id) || 0;
    }
    return { revenue, count, profit, aov: count > 0 ? revenue / count : 0 };
  };

  const cur = aggregate(now - 30 * DAY, now + 1);
  const prev = aggregate(now - 60 * DAY, now - 30 * DAY);
  const trend = (c: number, p: number) =>
    p === 0 ? (c > 0 ? 100 : 0) : Number((((c - p) / p) * 100).toFixed(1));

  return {
    revenue: { value: cur.revenue, trend: trend(cur.revenue, prev.revenue) },
    orders: { value: cur.count, trend: trend(cur.count, prev.count) },
    aov: { value: cur.aov, trend: trend(cur.aov, prev.aov) },
    profit: { value: cur.profit, trend: trend(cur.profit, prev.profit) },
  };
}

export async function getSalesTrends() {
  const db = await createDbClient();
  const { data, error } = await db
    .from("orders")
    .select("id, created_at, grand_total, total_amount, status")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error || !data) {
    if (error) console.error("Error fetching sales trends:", error);
    return [];
  }

  // Real per-order profit from order lines at cost. The previous version
  // fabricated profit as 35% of sales.
  const { data: items } = await db
    .from("order_items")
    .select("order_id, product_id, quantity, unit_price");
  const { data: products } = await db
    .from("products")
    .select("id, cost_price");
  const costByProduct = new Map<string, number>(
    (products || []).map((p: any) => [String(p.id), Number(p.cost_price) || 0] as [string, number])
  );
  const profitByOrder = new Map<string, number>();
  for (const it of (items || []) as any[]) {
    if (!it.product_id) continue;
    const margin =
      (Number(it.unit_price) || 0) - (costByProduct.get(it.product_id) || 0);
    profitByOrder.set(
      it.order_id,
      (profitByOrder.get(it.order_id) || 0) + margin * (Number(it.quantity) || 0)
    );
  }

  const grouped: Record<string, { sales: number; profit: number }> = {};
  for (const o of data) {
    const s = (o.status || "").toLowerCase();
    if (s === "cancelled" || s === "returned") continue;
    const dateKey = new Date(o.created_at).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    const val = Number(o.grand_total ?? o.total_amount) || 0;
    if (!grouped[dateKey]) {
      grouped[dateKey] = { sales: 0, profit: 0 };
    }
    grouped[dateKey].sales += val;
    grouped[dateKey].profit += profitByOrder.get(o.id) || 0;
  }

  return Object.entries(grouped)
    .reverse()
    .slice(-30)
    .map(([date, vals]) => ({
      date,
      sales: vals.sales,
      profit: vals.profit,
    }));
}

export async function getTopCategories() {
  // Real revenue by category from order lines (was a hardcoded array).
  const db = await createDbClient();
  const { data: orders } = await db
    .from("orders")
    .select("id, status");
  const liveOrderIds = new Set(
    (orders || [])
      .filter((o: any) => {
        const s = (o.status || "").toLowerCase();
        return s !== "cancelled" && s !== "returned" && s !== "failed" && s !== "refunded";
      })
      .map((o: any) => o.id)
  );

  const { data: items } = await db
    .from("order_items")
    .select("order_id, product_id, total_price");
  const { data: products } = await db
    .from("products")
    .select("id, category_id");
  const { data: categories } = await db
    .from("categories")
    .select("id, name");
  const categoryByProduct = new Map<string, string>(
    (products || []).map((p: any) => [String(p.id), String(p.category_id)] as [string, string])
  );
  const nameByCategory = new Map<string, string>(
    (categories || []).map((c: any) => [String(c.id), String(c.name)] as [string, string])
  );

  const totals = new Map<string, number>();
  for (const it of (items || []) as any[]) {
    if (!liveOrderIds.has(it.order_id) || !it.product_id) continue;
    const name =
      nameByCategory.get(categoryByProduct.get(String(it.product_id)) || "") || "Uncategorized";
    totals.set(name, (totals.get(name) || 0) + (Number(it.total_price) || 0));
  }

  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, value]) => ({ name, value }));
}

export async function getCustomerMetrics() {
  const db = await createDbClient();
  const { data, error } = await db
    .from("bi_customer_mart")
    .select("*")
    .order("date", { ascending: false })
    .limit(1)
    .single();

  if (error) {
    console.error("Error fetching customer metrics:", error);
    return null;
  }

  return data;
}

export async function getInventoryMetrics() {
  const db = await createDbClient();
  const { data, error } = await db
    .from("bi_inventory_mart")
    .select("*")
    .order("date", { ascending: false })
    .limit(1)
    .single();

  if (error) {
    console.error("Error fetching inventory metrics:", error);
    return null;
  }

  return data;
}
