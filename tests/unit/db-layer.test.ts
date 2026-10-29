/**
 * Behavioural tests for the native data layer (lib/db/query.ts).
 *
 * Runs the real query builder against in-memory fake Prisma delegates that
 * implement Prisma where/order semantics, and asserts the consumed contract:
 * { data, error, count } results, snake_case rows, per-table write
 * sanitizers and column aliases, graceful-empty results for unknown
 * tables/columns, PGRST116 on empty single(), and relation embeds.
 */
import { describe, it, expect, vi } from "vitest";

const fakeDelegates: Record<string, any> = {};
vi.mock("@/lib/prisma", () => ({
  default: new Proxy({}, { get: (_t, prop: string) => fakeDelegates[prop] }),
  prisma: new Proxy({}, { get: (_t, prop: string) => fakeDelegates[prop] }),
}));

import { createDbClient } from "@/lib/db/client";

// ---------- fake delegate ----------
type Row = Record<string, any>;
const stores = new Map<string, Row[]>();
function store(name: string): Row[] {
  if (!stores.has(name)) stores.set(name, []);
  return stores.get(name)!;
}

function matchVal(v: any, cond: any): boolean {
  if (cond === null || cond === undefined) return v === null || v === undefined;
  if (cond instanceof Date || (v instanceof Date && (cond === null || typeof cond !== "object"))) {
    return new Date(v).getTime() === new Date(cond).getTime();
  }
  if (typeof cond === "object" && !Array.isArray(cond)) {
    for (const [op, ov] of Object.entries(cond)) {
      if (op === "mode") continue;
      const ci = (cond as any).mode === "insensitive";
      const norm = (x: any) => (ci && typeof x === "string" ? x.toLowerCase() : x);
      switch (op) {
        case "equals": {
          if (v instanceof Date || ov instanceof Date) { if (new Date(v).getTime() !== new Date(ov as any).getTime()) return false; }
          else if (norm(v) !== norm(ov)) return false;
          break;
        }
        case "not": if (matchVal(v, ov)) return false; break;
        case "gt": if (!(v > (ov as any))) return false; break;
        case "gte": if (!(v >= (ov as any))) return false; break;
        case "lt": if (!(v < (ov as any))) return false; break;
        case "lte": if (!(v <= (ov as any))) return false; break;
        case "in": if (!(ov as any[]).map(norm).includes(norm(v))) return false; break;
        case "notIn": if ((ov as any[]).map(norm).includes(norm(v))) return false; break;
        case "contains": if (typeof v !== "string" || !norm(v).includes(norm(String(ov)))) return false; break;
        case "startsWith": if (typeof v !== "string" || !norm(v).startsWith(norm(String(ov)))) return false; break;
        case "endsWith": if (typeof v !== "string" || !norm(v).endsWith(norm(String(ov)))) return false; break;
        case "hasEvery": if (!Array.isArray(v) || !(ov as any[]).every((x) => v.includes(x))) return false; break;
        case "hasSome": if (!Array.isArray(v) || !(ov as any[]).some((x) => v.includes(x))) return false; break;
        case "has": if (!Array.isArray(v) || !v.includes(ov)) return false; break;
        case "isNull": if ((v === null || v === undefined) !== ov) return false; break;
        default: throw new Error("fake: unhandled op " + op);
      }
    }
    return true;
  }
  return v === cond;
}
function matchRow(row: Row, where: any): boolean {
  if (!where) return true;
  for (const [k, cond] of Object.entries(where)) {
    if (k === "AND") { if (!(cond as any[]).every((w) => matchRow(row, w))) return false; }
    else if (k === "OR") { if (!(cond as any[]).some((w) => matchRow(row, w))) return false; }
    else if (k === "NOT") { if (matchRow(row, cond)) return false; }
    else if (!matchVal(row[k], cond)) return false;
  }
  return true;
}
function applyOrder(rows: Row[], orderBy: any): Row[] {
  if (!orderBy) return rows;
  const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
  const out = [...rows];
  for (const spec of specs.reverse()) {
    for (const [f, dir] of Object.entries(spec)) {
      out.sort((a, b) => {
        const c = a[f] < b[f] ? -1 : a[f] > b[f] ? 1 : 0;
        return dir === "desc" ? -c : c;
      });
    }
  }
  return out;
}
function applyData(row: Row, data: any) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      if ("increment" in v) { row[k] = (row[k] ?? 0) + (v as any).increment; continue; }
      if ("decrement" in v) { row[k] = (row[k] ?? 0) - (v as any).decrement; continue; }
      if ("set" in v) { row[k] = (v as any).set; continue; }
    }
    row[k] = v;
  }
}
function fakeDelegate(name: string) {
  return {
    async findMany(args: any = {}) {
      let rows = store(name).filter((r) => matchRow(r, args.where));
      rows = applyOrder(rows, args.orderBy);
      if (args.skip) rows = rows.slice(args.skip);
      if (args.take !== undefined) rows = rows.slice(0, args.take);
      return rows.map((r) => ({ ...r }));
    },
    async findFirst(args: any = {}) {
      const rows = await this.findMany({ ...args, take: 1 });
      return rows[0] ?? null;
    },
    async count(args: any = {}) {
      return store(name).filter((r) => matchRow(r, args.where)).length;
    },
    async create(args: any) {
      const row = { ...args.data };
      store(name).push(row);
      return { ...row };
    },
    async createManyAndReturn(args: any) {
      return Promise.all(args.data.map((d: any) => this.create({ data: d })));
    },
    async update(args: any) {
      const row = store(name).find((r) => matchRow(r, args.where));
      if (!row) throw Object.assign(new Error("Record to update not found."), { code: "P2025" });
      applyData(row, args.data);
      return { ...row };
    },
    async updateMany(args: any) {
      const rows = store(name).filter((r) => matchRow(r, args.where));
      rows.forEach((r) => applyData(r, args.data));
      return { count: rows.length };
    },
    async deleteMany(args: any) {
      const before = store(name).length;
      stores.set(name, store(name).filter((r) => !matchRow(r, args.where)));
      return { count: before - store(name).length };
    },
  };
}

for (const d of ["setting", "warehouse", "profile", "role", "order", "orderItem", "inventoryLevel", "productCategory"]) {
  fakeDelegates[d] = fakeDelegate(d);
}
const db = createDbClient();

// ---------- fixtures ----------
const D = (s: string) => new Date(s);
store("setting").push(
  { id: "s1", key: "site_name", value: "Anchor", metadata: { channel: "web" }, createdAt: D("2026-01-01"), updatedAt: D("2026-01-01") },
  { id: "s2", key: "currency", value: "BDT", metadata: { channel: "pos" }, createdAt: D("2026-01-02"), updatedAt: D("2026-01-02") },
  { id: "s3", key: "tax_rate", value: "15", metadata: { channel: "web" }, createdAt: D("2026-01-03"), updatedAt: D("2026-01-03") }
);
store("role").push({ id: "r1", name: "admin", description: "Admin", isSystem: true, createdAt: D("2026-01-01"), updatedAt: D("2026-01-01") });
store("profile").push(
  { id: "p1", email: "a@x.com", firstName: "A", roleId: "r1", isActive: true, createdAt: D("2026-01-01"), updatedAt: D("2026-01-01") },
  { id: "p2", email: "b@x.com", firstName: "B", roleId: null, isActive: false, createdAt: D("2026-01-02"), updatedAt: D("2026-01-02") }
);
store("order").push(
  { id: "o1", orderNumber: "ORD-1", profileId: "p1", totalAmount: 500, status: "pending", shippingAddress: { city: "Dhaka", zip: "1207" }, createdAt: D("2026-01-01"), updatedAt: D("2026-01-01") },
  { id: "o2", orderNumber: "ORD-9", profileId: "p2", totalAmount: 300, status: "pending", shippingAddress: { city: "Khulna" }, createdAt: D("2026-01-02"), updatedAt: D("2026-01-02") }
);
store("orderItem").push(
  { id: "oi1", orderId: "o1", productName: "Shirt", quantity: 2, unitPrice: 250, createdAt: D("2026-01-01"), updatedAt: D("2026-01-01") }
);
store("inventoryLevel").push(
  { id: "il1", variantId: "v1", warehouseId: "w1", quantityAvailable: 10, quantityReserved: 2, quantityOnHand: 12, createdAt: D("2026-01-01"), updatedAt: D("2026-01-01") },
  { id: "il2", variantId: "v2", warehouseId: "w1", quantityAvailable: 0, quantityReserved: 0, quantityOnHand: 0, createdAt: D("2026-01-01"), updatedAt: D("2026-01-01") }
);

describe("lib/db behavioural parity", () => {
it("builder contract", async () => {
// ---------- tests ----------
let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: any) {
  if (cond) { pass++; console.log("  ok -", name); }
  else { fail++; console.log("  FAIL -", name, extra !== undefined ? JSON.stringify(extra).slice(0, 220) : ""); }
}

let r: any;
r = await db.from("settings").select("*").eq("key", "currency").single();
check("eq+single returns snake_case row", r.error === null && r.data?.key === "currency" && typeof r.data.created_at === "string", r);

r = await db.from("settings").select("*", { count: "exact" }).order("created_at", { ascending: false });
check("order desc + count exact", r.error === null && r.count === 3 && r.data[0].key === "tax_rate", r);

r = await db.from("settings").select("*", { count: "exact", head: true });
check("head count → data null, count 3", r.data === null && r.count === 3, r);

r = await db.from("settings").select("*").eq("key", "nope").single();
check("single() empty → PGRST116", r.data === null && r.error?.code === "PGRST116", r);

r = await db.from("settings").select("*").eq("key", "nope").maybeSingle();
check("maybeSingle() empty → PGRST116 (shim parity)", r.data === null && r.error?.code === "PGRST116", r);

r = await db.from("does_not_exist").select("*");
check("unknown table → graceful empty", Array.isArray(r.data) && r.data.length === 0 && r.error === null, r);

r = await db.from("settings").select("*").eq("no_such_col", "x");
check("unknown column filter → graceful empty", Array.isArray(r.data) && r.data.length === 0 && r.error === null, r);

r = await db.from("warehouses").insert({ name: "Main", warehouse_code: "WH-01", type: "hub", status: "active", address: "Dhaka" }).select();
check("warehouse insert: code remapped, type/status dropped, uuid id",
  r.error === null && r.data[0].code === "WH-01" && !("type" in r.data[0]) && !("status" in r.data[0]) && /^[0-9a-f-]{36}$/.test(r.data[0].id), r);

r = await db.from("orders").insert({ order_number: "ORD-2", grand_total: 900, risk_score: 5, session_id: "abc", status: "pending" }).select();
check("orders insert: grand_total→total_amount, risk/session dropped",
  r.error === null && r.data[0].total_amount === 900 && !("risk_score" in r.data[0]) && !("session_id" in r.data[0]), r);

r = await db.from("settings").upsert({ key: "currency", value: "USD" }, { onConflict: "key" }).select();
check("upsert conflict updates existing", r.error === null && r.data[0].value === "USD", r);
r = await db.from("settings").select("*").eq("key", "currency").single();
check("upsert did not duplicate", r.data?.value === "USD", r);

r = await db.from("settings").update({}).eq("key", "currency");
check("empty update payload → 42601 error", r.error?.code === "42601", r);

r = await db.from("inventory_levels").select("*").eq("bin_id", "anything");
check("inventory_levels bin_id filter dropped → all rows", r.error === null && r.data.length === 2, r);

r = await db.from("profiles").select("*, roles(name)").eq("id", "p1").single();
check("profiles roles embed attached", r.error === null && r.data?.roles?.name === "admin", r);

r = await db.from("orders").select("*, order_items(*)").eq("id", "o1").single();
check("orders order_items embed attached (snake_case)",
  r.error === null && Array.isArray(r.data?.order_items) && r.data.order_items[0].product_name === "Shirt", r);

r = await db.from("orders").select("*").contains("shipping_address", { city: "Dhaka" });
check("JSON contains post-filter", r.error === null && r.data.length === 1 && r.data[0].order_number === "ORD-1", r);

r = await db.from("settings").select("*").ilike("key", "%curr%");
check("ilike %x% contains", r.error === null && r.data.length === 1 && r.data[0].key === "currency", r);
r = await db.from("settings").select("*").ilike("key", "CURRENCY");
check("ilike bare = ci equals", r.error === null && r.data.length === 1, r);

r = await db.from("settings").select("*").or("key.eq.site_name,key.eq.tax_rate");
check("or() two eq branches", r.error === null && r.data.length === 2, r);

r = await db.from("settings").select("*").in("key", ["site_name", "tax_rate"]);
check("in() list", r.error === null && r.data.length === 2, r);

r = await db.from("settings").select("*").gte("created_at", "2026-01-02").order("created_at");
check("gte on date + asc order", r.error === null && r.data.length === 2 && r.data[0].key === "currency", r);

r = await db.from("product_categories").insert({ product_id: "prod1", category_id: "cat1" }).select();
check("composite-id table insert (no uuid assigned)", r.error === null && r.data[0].product_id === "prod1", r);

r = await db.from("settings").delete().eq("key", "tax_rate");
check("delete returns removed row", r.error === null && r.data.length === 1 && r.data[0].key === "tax_rate", r);
r = await db.from("settings").select("*", { count: "exact", head: true });
check("count after delete = 2", r.count === 2, r);

expect(fail).toBe(0);
});

});
