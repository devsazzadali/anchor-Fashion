/**
 * Native Prisma data-access builder (lib/db).
 *
 * This module is the project's data layer: a small fluent builder over the
 * Prisma client delegates. It exists because large parts of the app were
 * written against a row-oriented contract — plain snake_case row objects and
 * a `{ data, error, count }` result — and this layer preserves that contract
 * exactly while executing everything through Prisma (lib/prisma) using the
 * schema-derived field map (lib/db/field-map.ts).
 *
 * Behavioural notes (kept deliberately, they are load-bearing):
 * - Column aliases: warehouse_code→code, payment_intent_id→payment_txn_id,
 *   user_id→profile_id, grand_total→total_amount, discount_amount→discount.
 * - Table alias: order_shipments→shipments.
 * - Filters on inventory_levels.bin_id are ignored (the column is not part of
 *   the inventory model; filters referencing it historically matched all).
 * - Unknown tables/columns resolve to an empty success result instead of
 *   throwing, so optional modules degrade gracefully.
 * - Per-table write sanitizers below mirror the database's real column sets
 *   (some callers pass legacy/extra keys that must not reach the DB).
 */
import prisma from "@/lib/prisma";
import { randomUUID } from "crypto";
import { DB_TABLES, type DbFieldMeta, type DbTableMeta } from "./field-map";
import { escapeLikeWildcards } from "@/lib/utils/like-escape";

const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
function assertIdent(name: string, kind = "identifier"): string {
  if (typeof name !== "string" || !SAFE_IDENT.test(name)) {
    throw new Error(`Invalid SQL ${kind}`);
  }
  return name;
}

/* ------------------------------------------------------------------ */
/* REG-83: embedded-select support matrix.                             */
/*                                                                     */
/* PostgREST-style embedded selects (`relation(cols)`) are attached    */
/* by attachRelations() for exactly the (table → relations) pairs      */
/* below. Any other embedded select used to be SILENTLY DROPPED — the  */
/* caller received rows without the relation and no error, which       */
/* produced wrong data downstream (e.g. analytics bucketing every      */
/* product under a literal fallback category name). Unsupported        */
/* embedded selects now fail loudly: an error result in development,   */
/* an explicit error log in production, until the call site is         */
/* migrated to a Prisma read.                                          */
/* ------------------------------------------------------------------ */

/**
 * REG-84: hard ceiling for SELECTs that specify no limit/range of
 * their own. Far above every current table (largest ≈ 719 rows), so
 * no current result set changes; it exists to stop pathological
 * full-table materialization as tables grow, and it LOGS LOUDLY when
 * it bites instead of truncating silently.
 */
const MAX_UNBOUNDED_ROWS = 10000;

const EMBEDDED_SELECT_SUPPORT: Record<string, ReadonlySet<string>> = {
  profiles: new Set(["roles"]),
  customer_profiles: new Set(["roles"]),
  orders: new Set(["order_items"]),
  customer_orders: new Set(["order_items"]),
  products: new Set(["variants", "product_media"]),
  store_products: new Set(["variants", "product_media"]),
};

/** Splits a select list on top-level commas (paren-depth aware). */
function splitSelectList(selectCols: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of selectCols) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/** Extracts embedded relation names (`relation(cols)`, `alias:relation(cols)`, `relation!hint(cols)`). */
function parseEmbeddedRelations(selectCols: string): string[] {
  if (!selectCols || selectCols.trim() === "*") return [];
  const relations: string[] = [];
  for (const segment of splitSelectList(selectCols)) {
    const open = segment.indexOf("(");
    if (open === -1) continue;
    let head = segment.slice(0, open).trim();
    if (head.includes(":")) head = head.split(":").pop()!.trim(); // alias:relation
    head = head.split("!")[0].trim(); // relation!hint
    if (SAFE_IDENT.test(head)) relations.push(head);
  }
  return relations;
}

/**
 * Throws (dev) / logs (production) for every embedded relation in the
 * select that attachRelations() cannot attach for this table.
 */
function assertEmbeddedSelectsSupported(tableName: string, selectCols: string): void {
  const supported = EMBEDDED_SELECT_SUPPORT[tableName];
  for (const relation of parseEmbeddedRelations(selectCols)) {
    if (supported?.has(relation)) continue;
    const message =
      `[DbQueryBuilder] Unsupported embedded select "${relation}(...)" on table "${tableName}" — ` +
      `this builder cannot attach that relation, so rows would be returned WITHOUT it. ` +
      `Migrate this call site to a Prisma read (REG-83).`;
    if (process.env.NODE_ENV !== "production") {
      const err = new Error(message) as Error & { code?: string };
      err.code = "REG83_UNSUPPORTED_EMBED";
      throw err;
    }
    console.error(message);
  }
}

export function serializePlain(val: any): any {
  if (val === null || val === undefined) return val;
  if (val instanceof Date) return val.toISOString();
  if (typeof val === "bigint") return Number(val);
  if (typeof val === "object") {
    if (typeof (val as any).toNumber === "function") return (val as any).toNumber();
    if (typeof (val as any).toFixed === "function" && typeof val !== "string") {
      const num = Number(val);
      if (!isNaN(num)) return num;
    }
    if (Array.isArray(val)) return val.map(serializePlain);
    const res: Record<string, any> = {};
    for (const key of Object.keys(val)) {
      res[key] = serializePlain(val[key]);
    }
    return res;
  }
  return val;
}

const COLUMN_ALIASES: Record<string, string> = {
  warehouse_code: "code",
  payment_intent_id: "payment_txn_id",
  user_id: "profile_id",
  grand_total: "total_amount",
  discount_amount: "discount",
};

interface ResolvedColumn {
  /** snake_case column name in the DB */
  col: string;
  meta: DbFieldMeta;
  /** JSON path segments when the reference used -> / ->> */
  jsonPath?: string[];
}

/** Split a column reference into its base column + optional JSON path. */
function splitJsonAccessor(raw: string): { col: string; path?: string[] } {
  let s = raw.trim().replace(/^"|"$/g, "");
  if (s.includes("->")) {
    const parts = s.split(/->>?/);
    const col = parts[0].trim().replace(/^"|"$/g, "");
    const path = parts
      .slice(1)
      .map((k) => k.trim().replace(/^['"]|['"]$/g, ""));
    return { col, path };
  }
  return { col: s };
}

const INVALID = Symbol("invalid-coercion");

/** Coerce a JS value to the Prisma field's type, following the loose
 *  text-comparison semantics the app was built against. */
function coerceValue(meta: DbFieldMeta, val: any): any {
  if (val === null || val === undefined) return val;
  if (meta.list) return val;
  switch (meta.type) {
    case "Int":
    case "Float":
    case "Decimal": {
      if (typeof val === "number") return val;
      if (typeof val === "boolean") return val ? 1 : 0;
      if (typeof val === "string" && val.trim() !== "" && !isNaN(Number(val)))
        return Number(val);
      return INVALID;
    }
    case "BigInt": {
      try {
        return typeof val === "bigint" ? val : BigInt(val);
      } catch {
        return INVALID;
      }
    }
    case "Boolean": {
      if (typeof val === "boolean") return val;
      if (val === "true") return true;
      if (val === "false") return false;
      if (val === 1) return true;
      if (val === 0) return false;
      return INVALID;
    }
    case "DateTime": {
      if (val instanceof Date) return val;
      if (typeof val === "string" || typeof val === "number") {
        const d = new Date(val);
        return isNaN(d.getTime()) ? INVALID : d;
      }
      return INVALID;
    }
    case "Json":
      return val;
    default: {
      // String / enum / uuid-like: text semantics — stringify scalars.
      if (typeof val === "string") return val;
      if (typeof val === "number" || typeof val === "boolean") return String(val);
      return val;
    }
  }
}

/** PostgreSQL jsonb @> containment check (used for JSON filters Prisma
 *  cannot express natively). */
function jsonContains(container: any, containee: any): boolean {
  if (containee === null || typeof containee !== "object") {
    return serializePlain(container) === serializePlain(containee) ||
      container === containee;
  }
  if (Array.isArray(containee)) {
    if (!Array.isArray(container)) return false;
    return containee.every((c) => container.some((v) => jsonContains(v, c)));
  }
  if (container === null || typeof container !== "object" || Array.isArray(container))
    return false;
  return Object.keys(containee).every(
    (k) => k in container && jsonContains(container[k], containee[k])
  );
}

/* ------------------------------------------------------------------ */
/* Per-table write sanitizers (mirror the real column sets / legacy    */
/* key handling the app relies on). They operate on snake_case keys.   */
/* ------------------------------------------------------------------ */

function sanitizeWarehouses(item: any) {
  if (item.warehouse_code && !item.code) item.code = item.warehouse_code;
  if (item.capacity_sqft !== undefined && item.capacity === undefined) {
    item.capacity = item.capacity_sqft ? Math.round(Number(item.capacity_sqft)) : null;
  }
  delete item.warehouse_code;
  delete item.capacity_sqft;
  delete item.type;
  delete item.status;
}

function sanitizeInventoryLevels(item: any) {
  delete item.bin_id;
  delete item.quantity_incoming;
  delete item.quantity_damaged;
  delete item.quantity_returned;
  delete item.safety_stock;
}

function sanitizeOrders(item: any) {
  if (item.payment_intent_id && !item.payment_txn_id) {
    item.payment_txn_id = item.payment_intent_id;
  }
  if (item.user_id && !item.profile_id) {
    item.profile_id = item.user_id;
  }
  if (item.grand_total !== undefined && item.total_amount === undefined) {
    item.total_amount = item.grand_total;
  }
  if (item.discount_amount !== undefined && item.discount === undefined) {
    item.discount = item.discount_amount;
  }
  delete item.payment_intent_id;
  delete item.user_id;
  delete item.grand_total;
  delete item.discount_amount;
  delete item.risk_level;
  delete item.risk_score;
  delete item.risk_reasons;
  delete item.verification_status;
  delete item.verification_verified_at;
  delete item.session_id;
  delete item.idempotency_key;
  delete item.currency;
  delete item.coupon_id;
}

function sanitizeStockMovementsInsert(item: any) {
  if (item.quantity_change !== undefined && item.quantity === undefined) {
    item.quantity = Number(item.quantity_change) || 0;
  }
  if (!item.movement_type) {
    item.movement_type =
      item.reason_code || (item.quantity && item.quantity < 0 ? "OUT" : "IN");
  }
  if (item.previous_quantity === undefined) item.previous_quantity = 0;
  if (item.new_quantity === undefined) item.new_quantity = Number(item.quantity) || 0;
  if (!item.notes) item.notes = item.reason || `Stock movement ${item.movement_type}`;
  if (!item.created_by && item.user_id) item.created_by = item.user_id;
  delete item.quantity_change;
  delete item.reason;
  delete item.reason_code;
  delete item.user_id;
  delete item.from_bin_id;
  delete item.to_bin_id;
  delete item.to_warehouse_id;
}

const RETURNS_ALLOWED = new Set([
  "id", "return_number", "order_id", "customer_id", "status", "reason",
  "notes", "refund_amount", "created_at", "updated_at",
]);
const RETURN_ITEMS_ALLOWED = new Set([
  "id", "return_id", "order_item_id", "variant_id", "quantity", "reason",
  "condition", "restocked", "created_at",
]);

function sanitizeReturns(item: any, isUpdate: boolean) {
  if (item.customer_note && !item.notes) item.notes = item.customer_note;
  if (isUpdate && item.internal_note && !item.notes) item.notes = item.internal_note;
  for (const k of Object.keys(item)) {
    if (!RETURNS_ALLOWED.has(k)) delete item[k];
  }
}

function sanitizeReturnItems(item: any) {
  for (const k of Object.keys(item)) {
    if (!RETURN_ITEMS_ALLOWED.has(k)) delete item[k];
  }
}

function applyInsertSanitizers(table: string, item: any) {
  switch (table) {
    case "warehouses": sanitizeWarehouses(item); break;
    case "inventory_levels": sanitizeInventoryLevels(item); break;
    case "orders": sanitizeOrders(item); break;
    case "stock_movements": sanitizeStockMovementsInsert(item); break;
    case "returns": sanitizeReturns(item, false); break;
    case "return_items": sanitizeReturnItems(item); break;
  }
}

function applyUpdateSanitizers(table: string, item: any) {
  switch (table) {
    case "warehouses": sanitizeWarehouses(item); break;
    case "inventory_levels": sanitizeInventoryLevels(item); break;
    case "orders": sanitizeOrders(item); break;
    case "returns": sanitizeReturns(item, true); break;
    case "return_items": sanitizeReturnItems(item); break;
  }
}

/* ------------------------------------------------------------------ */

type PostFilter = (camelRow: any) => boolean;

export class DbQueryBuilder implements PromiseLike<any> {
  private tableName: string;
  private meta?: DbTableMeta;
  private selectCols: string = "*";
  private andFragments: any[] = [];
  private postFilters: PostFilter[] = [];
  private isSingle = false;
  private limitCount?: number;
  private orderBy: any[] = [];
  private action: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private payload: any;
  private rangeStart?: number;
  private rangeEnd?: number;
  private wantCount = false;
  private headOnly = false;
  private onConflictCols?: string;
  /** Unknown table/column or un-coercible positive condition → the query
   *  resolves to an empty success (historical graceful-degradation contract). */
  private poisoned = false;
  private errorOut: { code: string; message: string } | null = null;
  private execPromise?: Promise<any>;

  constructor(tableName: string) {
    let clean = assertIdent(tableName, "table");
    if (clean === "order_shipments") clean = "shipments";
    this.tableName = clean;
    this.meta = DB_TABLES[clean];
    if (!this.meta) this.poisoned = true;
  }

  private delegate(): any {
    return (prisma as any)[this.meta!.delegate];
  }

  /** Resolve a (possibly qualified / aliased / JSON-accessor) column ref. */
  private resolve(rawCol: string): ResolvedColumn | null {
    const { col: base, path } = splitJsonAccessor(rawCol);
    let col = base;
    if (col.includes(".")) col = col.split(".").pop()!;
    col = col.replace(/^"|"$/g, "");
    if (COLUMN_ALIASES[col]) col = COLUMN_ALIASES[col];
    const meta = this.meta?.fields[col];
    if (!meta) return null;
    return { col, meta, jsonPath: path };
  }

  select(cols: string = "*", opts?: { count?: string; head?: boolean }) {
    if (!["insert", "update", "upsert", "delete"].includes(this.action)) {
      this.action = "select";
    }
    this.selectCols = cols;
    if (opts?.count) this.wantCount = true;
    if (opts?.head) this.headOnly = true;
    return this;
  }

  insert(data: any) {
    this.action = "insert";
    this.payload = data;
    return this;
  }

  update(data: any) {
    this.action = "update";
    this.payload = data;
    return this;
  }

  upsert(data: any, opts?: any) {
    this.action = "upsert";
    this.payload = data;
    if (opts?.onConflict) this.onConflictCols = opts.onConflict;
    return this;
  }

  delete() {
    this.action = "delete";
    return this;
  }

  eq(col: string, val: any) {
    if (this.tableName === "inventory_levels" && (col === "bin_id" || col.endsWith(".bin_id"))) {
      return this;
    }
    const r = this.resolve(col);
    if (!r) { this.poisoned = true; return this; }
    if (r.jsonPath) {
      this.andFragments.push({ [r.meta.field]: { path: r.jsonPath, equals: val } });
      return this;
    }
    if (val === null) {
      this.andFragments.push({ [r.meta.field]: null });
      return this;
    }
    const v = coerceValue(r.meta, val);
    if (v === INVALID) { this.poisoned = true; return this; }
    this.andFragments.push({ [r.meta.field]: v });
    return this;
  }

  neq(col: string, val: any) {
    const r = this.resolve(col);
    if (!r) { this.poisoned = true; return this; }
    if (r.jsonPath) {
      this.andFragments.push({ NOT: { [r.meta.field]: { path: r.jsonPath, equals: val } } });
      return this;
    }
    if (val === null) {
      this.andFragments.push({ [r.meta.field]: { not: null } });
      return this;
    }
    const v = coerceValue(r.meta, val);
    if (v === INVALID) return this; // text-inequality against an un-coercible value matches everything
    this.andFragments.push({ [r.meta.field]: { not: v } });
    return this;
  }

  private compare(col: string, val: any, op: "gt" | "gte" | "lt" | "lte") {
    const r = this.resolve(col);
    if (!r) { this.poisoned = true; return this; }
    if (r.jsonPath) { this.poisoned = true; return this; }
    const v = coerceValue(r.meta, val);
    if (v === INVALID) { this.poisoned = true; return this; }
    this.andFragments.push({ [r.meta.field]: { [op]: v } });
    return this;
  }

  gt(col: string, val: any) { return this.compare(col, val, "gt"); }
  gte(col: string, val: any) { return this.compare(col, val, "gte"); }
  lt(col: string, val: any) { return this.compare(col, val, "lt"); }
  lte(col: string, val: any) { return this.compare(col, val, "lte"); }

  private likeImpl(col: string, val: any, insensitive: boolean) {
    const r = this.resolve(col);
    if (!r) { this.poisoned = true; return this; }
    if (r.meta.type !== "String" || r.jsonPath) {
      this.errorOut = { code: "42883", message: "operator does not exist" };
      return this;
    }
    const pattern = String(val);
    const mode = insensitive ? { mode: "insensitive" as const } : {};
    let frag: any;
    const hasLead = pattern.startsWith("%");
    const hasTrail = pattern.endsWith("%") && pattern.length > 1;
    const core = pattern.replace(/^%/, "").replace(/%$/, "");
    // REG-43: the leading/trailing % are the caller's contains markers;
    // the core is literal text. Prisma turns contains/startsWith/
    // endsWith into a Postgres LIKE pattern without escaping, so any
    // %/_/\ inside the core must be escaped or it acts as a wildcard
    // (a search for "%" matched every row). The equals branch is an
    // exact match (no LIKE) and stays untouched.
    if (!pattern.includes("%") && !pattern.includes("_")) {
      frag = { [r.meta.field]: { equals: pattern, ...mode } };
    } else if (hasLead && hasTrail) {
      frag = { [r.meta.field]: { contains: escapeLikeWildcards(core), ...mode } };
    } else if (hasTrail && !hasLead) {
      frag = { [r.meta.field]: { startsWith: escapeLikeWildcards(core), ...mode } };
    } else if (hasLead && !hasTrail) {
      frag = { [r.meta.field]: { endsWith: escapeLikeWildcards(core), ...mode } };
    } else {
      // Pattern with wildcards in the middle (e.g. "a%b" with no edge
      // markers): match the literal core — escaping keeps %/_ literal
      // instead of the previous behaviour of silently deleting them.
      frag = { [r.meta.field]: { contains: escapeLikeWildcards(core), ...mode } };
    }
    this.andFragments.push(frag);
    return this;
  }

  like(col: string, val: any) { return this.likeImpl(col, val, false); }
  ilike(col: string, val: any) { return this.likeImpl(col, val, true); }

  is(col: string, val: any) {
    if (this.tableName === "inventory_levels" && (col === "bin_id" || col.endsWith(".bin_id"))) {
      return this;
    }
    const r = this.resolve(col);
    if (!r) { this.poisoned = true; return this; }
    if (val === null) {
      this.andFragments.push({ [r.meta.field]: null });
    } else if (typeof val === "boolean") {
      this.andFragments.push({ [r.meta.field]: val });
    } else {
      return this.eq(col, val);
    }
    return this;
  }

  in(col: string, vals: any) {
    const r = this.resolve(col);
    if (!r) { this.poisoned = true; return this; }
    const items = Array.isArray(vals)
      ? vals
      : typeof vals === "string"
      ? vals.trim().replace(/^\(|\)$/g, "").split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
      : [vals];
    if (!items || items.length === 0) { this.poisoned = true; return this; }
    const coerced: any[] = [];
    for (const it of items) {
      const v = r.jsonPath ? it : coerceValue(r.meta, it);
      if (v === INVALID) { this.poisoned = true; return this; }
      coerced.push(v);
    }
    if (r.jsonPath) {
      this.andFragments.push({ OR: coerced.map((v) => ({ [r.meta.field]: { path: r.jsonPath, equals: v } })) });
    } else {
      this.andFragments.push({ [r.meta.field]: { in: coerced } });
    }
    return this;
  }

  contains(col: string, val: any) {
    const r = this.resolve(col);
    if (!r) { this.poisoned = true; return this; }
    if (r.meta.list) {
      const arr = Array.isArray(val) ? val : [val];
      this.andFragments.push({ [r.meta.field]: { hasEvery: arr } });
    } else if (r.meta.type === "Json") {
      const field = r.meta.field;
      this.postFilters.push((row) => jsonContains(row[field], val));
    } else {
      this.poisoned = true;
    }
    return this;
  }

  containedBy(col: string, val: any) {
    const r = this.resolve(col);
    if (!r) { this.poisoned = true; return this; }
    const field = r.meta.field;
    if (r.meta.list) {
      this.postFilters.push((row) =>
        Array.isArray(row[field]) && row[field].every((v: any) => (val as any[]).includes(v))
      );
    } else if (r.meta.type === "Json") {
      this.postFilters.push((row) => jsonContains(val, row[field]));
    } else {
      this.poisoned = true;
    }
    return this;
  }

  overlaps(col: string, val: any) {
    const r = this.resolve(col);
    if (!r) { this.poisoned = true; return this; }
    if (r.meta.list) {
      const arr = Array.isArray(val) ? val : [val];
      this.andFragments.push({ [r.meta.field]: { hasSome: arr } });
    } else if (r.meta.type === "Json") {
      const field = r.meta.field;
      this.postFilters.push((row) =>
        Array.isArray(row[field]) && Array.isArray(val) &&
        (row[field] as any[]).some((v) => (val as any[]).some((w) => jsonContains(v, w) || v === w))
      );
    } else {
      this.poisoned = true;
    }
    return this;
  }

  match(obj: Record<string, any>) {
    for (const [k, v] of Object.entries(obj)) this.eq(k, v);
    return this;
  }

  not(col: string, op: string, val: any) {
    const r = this.resolve(col);
    if (!r) { this.poisoned = true; return this; }
    if (op === "is" && val === null) {
      this.andFragments.push({ [r.meta.field]: { not: null } });
    } else if (op === "in") {
      const items = Array.isArray(val)
        ? val
        : typeof val === "string"
        ? val.trim().replace(/^\(|\)$/g, "").split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
        : [val];
      if (!items || items.length === 0) return this;
      const coerced = items.map((it: any) => coerceValue(r.meta, it));
      if (coerced.includes(INVALID)) return this;
      this.andFragments.push({ [r.meta.field]: { notIn: coerced } });
    } else if (op === "eq") {
      return this.neq(col, val);
    } else {
      const v = coerceValue(r.meta, val);
      if (v === INVALID) return this;
      this.andFragments.push({ NOT: { [r.meta.field]: v } });
    }
    return this;
  }

  or(filterStr: string) {
    const parts = filterStr.split(",");
    const orFrags: any[] = [];
    for (const part of parts) {
      const [col, op, ...rest] = part.split(".");
      const val = rest.join(".");
      const r = this.resolve(col);
      if (!r) { this.poisoned = true; return this; }
      const field = r.meta.field;
      if (op === "ilike" || op === "like") {
        if (r.meta.type !== "String") { this.poisoned = true; return this; }
        const mode = op === "ilike" ? { mode: "insensitive" as const } : {};
        const core = val.replace(/^%/, "").replace(/%$/, "");
        // REG-43: escape the literal core — see likeImpl.
        orFrags.push(val.includes("%")
          ? { [field]: { contains: escapeLikeWildcards(core), ...mode } }
          : { [field]: { equals: val, ...mode } });
        continue;
      }
      const v = coerceValue(r.meta, val);
      if (v === INVALID) { this.poisoned = true; return this; }
      switch (op) {
        case "eq": orFrags.push({ [field]: v }); break;
        case "neq": orFrags.push({ [field]: { not: v } }); break;
        case "gt": orFrags.push({ [field]: { gt: v } }); break;
        case "gte": orFrags.push({ [field]: { gte: v } }); break;
        case "lt": orFrags.push({ [field]: { lt: v } }); break;
        case "lte": orFrags.push({ [field]: { lte: v } }); break;
        default: orFrags.push({ [field]: v });
      }
    }
    if (orFrags.length > 0) this.andFragments.push({ OR: orFrags });
    return this;
  }

  filter(col: string, op: string, val: any) {
    switch (op) {
      case "eq": return this.eq(col, val);
      case "neq": return this.neq(col, val);
      case "gt": return this.gt(col, val);
      case "gte": return this.gte(col, val);
      case "lt": return this.lt(col, val);
      case "lte": return this.lte(col, val);
      case "like": return this.like(col, val);
      case "ilike": return this.ilike(col, val);
      case "is": return this.is(col, val);
      case "in": return this.in(col, val);
      case "contains": return this.contains(col, val);
      default: return this.eq(col, val);
    }
  }

  textSearch(col: string, query: string, _opts?: any) {
    const r = this.resolve(col);
    if (!r) { this.poisoned = true; return this; }
    this.andFragments.push({
      [r.meta.field]: { contains: escapeLikeWildcards(query), mode: "insensitive" },
    });
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }) {
    const r = this.resolve(col);
    if (!r || r.jsonPath) { this.poisoned = true; return this; }
    this.orderBy.push({ [r.meta.field]: opts?.ascending === false ? "desc" : "asc" });
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  range(start: number, end: number) {
    this.rangeStart = start;
    this.rangeEnd = end;
    return this;
  }

  single() {
    this.isSingle = true;
    this.limitCount = 1;
    return this;
  }

  maybeSingle() {
    this.isSingle = true;
    this.limitCount = 1;
    return this;
  }

  returns() { return this; }
  csv() { return this; }
  abortSignal() { return this; }
  throwOnError() { return this; }

  /* ------------------------- internals ------------------------- */

  private where(): any | undefined {
    if (this.andFragments.length === 0) return undefined;
    if (this.andFragments.length === 1) return this.andFragments[0];
    return { AND: this.andFragments };
  }

  private toSnakeRow(camelRow: any): any {
    const out: Record<string, any> = {};
    const fields = this.meta!.fields;
    for (const col of Object.keys(fields)) {
      const f = fields[col].field;
      if (camelRow && f in camelRow) out[col] = serializePlain(camelRow[f]);
    }
    return out;
  }

  /** Map a snake_case payload object to Prisma data (camelCase fields). */
  private toCamelData(item: Record<string, any>): Record<string, any> | null {
    const data: Record<string, any> = {};
    for (const key of Object.keys(item)) {
      const fm = this.meta!.fields[key];
      if (!fm) return null; // unknown column → caller treats as graceful empty
      let val = item[key];
      if (val === undefined) continue;
      if (val !== null && !fm.list && fm.type !== "Json") {
        const v = coerceValue(fm, val);
        if (v === INVALID) return null;
        val = v;
      }
      data[fm.field] = val;
    }
    return data;
  }

  private applyRowFixups(rows: any[]) {
    if (!rows || rows.length === 0) return rows;
    if (this.tableName === "warehouses") {
      for (const row of rows) {
        if (row.code && !row.warehouse_code) row.warehouse_code = row.code;
      }
    }
    if (this.tableName === "orders") {
      for (const row of rows) {
        if (row.total_amount !== undefined && row.grand_total === undefined) {
          row.grand_total = row.total_amount;
        }
        if (row.grand_total !== undefined && row.total_amount === undefined) {
          row.total_amount = row.grand_total;
        }
        if (row.discount !== undefined && row.discount_total === undefined) {
          row.discount_total = row.discount;
        }
        if (row.shipping_fee !== undefined && row.shipping_total === undefined) {
          row.shipping_total = row.shipping_fee;
        }
        if (row.profile_id && !row.customer_id) row.customer_id = row.profile_id;
        if (row.customer_id && !row.profile_id) row.profile_id = row.customer_id;
      }
    }
    if (this.tableName === "order_items") {
      for (const row of rows) {
        if (row.total_price !== undefined && row.line_total === undefined) {
          row.line_total = row.total_price;
        }
        if (row.line_total !== undefined && row.total_price === undefined) {
          row.total_price = row.line_total;
        }
      }
    }
    return rows;
  }

  private async attachRelations(rows: any[]) {
    // REG-83: fail loudly on embedded selects this builder cannot attach
    // (checked even for empty result sets, and outside the try/catch
    // below so the development error is never swallowed into a warning).
    assertEmbeddedSelectsSupported(this.tableName, this.selectCols);
    if (!rows || rows.length === 0) return rows;
    try {
      if (
        (this.tableName === "profiles" || this.tableName === "customer_profiles") &&
        this.selectCols.includes("roles")
      ) {
        const roleIds = [...new Set(rows.map((r) => r.role_id).filter(Boolean))];
        if (roleIds.length > 0) {
          const roles = await prisma.role.findMany({
            where: { id: { in: roleIds } },
          });
          const roleMap = new Map(roles.map((r) => [r.id, serializePlain(r)]));
          for (const row of rows) {
            row.roles = roleMap.get(row.role_id) || null;
          }
        }
      }

      if (
        (this.tableName === "orders" || this.tableName === "customer_orders") &&
        this.selectCols.includes("order_items")
      ) {
        const orderIds = rows.map((r) => r.id).filter(Boolean);
        if (orderIds.length > 0) {
          const items = await prisma.orderItem.findMany({
            where: { orderId: { in: orderIds } },
          });
          const itemMeta = DB_TABLES["order_items"];
          const itemMap = new Map<string, any[]>();
          for (const it of items as any[]) {
            const snake: Record<string, any> = {};
            for (const col of Object.keys(itemMeta.fields)) {
              const f = itemMeta.fields[col].field;
              if (f in it) snake[col] = serializePlain(it[f]);
            }
            if (!itemMap.has(snake.order_id)) itemMap.set(snake.order_id, []);
            itemMap.get(snake.order_id)!.push(snake);
          }
          for (const row of rows) {
            row.order_items = itemMap.get(row.id) || [];
          }
        }
      }

      if (
        (this.tableName === "products" || this.tableName === "store_products") &&
        (this.selectCols.includes("variants") ||
          this.selectCols.includes("product_media") ||
          this.selectCols.includes("categories"))
      ) {
        const productIds = rows.map((r) => r.id).filter(Boolean);
        if (productIds.length > 0) {
          if (this.selectCols.includes("variants")) {
            try {
              const vars = (await (prisma as any).variant.findMany({
                where: { productId: { in: productIds } },
              })) as any[];
              const varMap = new Map<string, any[]>();
              for (const v of vars) {
                const pId = v.productId || v.product_id;
                if (pId) {
                  if (!varMap.has(pId)) varMap.set(pId, []);
                  varMap.get(pId)!.push(serializePlain(v));
                }
              }
              for (const row of rows) {
                row.variants = varMap.get(row.id) || [];
              }
            } catch {}
          }
          if (this.selectCols.includes("product_media")) {
            try {
              const mediaList = (await (prisma as any).productMedia.findMany({
                where: { productId: { in: productIds } },
                orderBy: { displayOrder: "asc" },
              })) as any[];
              const mediaMap = new Map<string, any[]>();
              for (const m of mediaList) {
                const pId = m.productId || m.product_id;
                if (pId) {
                  if (!mediaMap.has(pId)) mediaMap.set(pId, []);
                  mediaMap.get(pId)!.push(serializePlain(m));
                }
              }
              for (const row of rows) {
                row.product_media = mediaMap.get(row.id) || [];
              }
            } catch {}
          }
        }
      }
    } catch (relErr) {
      console.warn("[attachRelations] Notice:", relErr);
    }
    return rows;
  }

  private gracefulEmpty() {
    return { data: this.isSingle ? null : [], error: null, count: 0 };
  }

  private finish(result: any[], count: number | null) {
    if (this.headOnly) {
      return { data: null, error: null, count };
    }
    if (this.isSingle) {
      if (!result || result.length === 0) {
        return {
          data: null,
          error: { code: "PGRST116", message: "No rows found" },
          count,
        };
      }
      return { data: result[0], error: null, count };
    }
    return { data: result || [], error: null, count };
  }

  private pkWhere(camelRow: any): any | null {
    const meta = this.meta!;
    const idCols = Object.keys(meta.fields).filter((c) => meta.fields[c].id);
    if (idCols.length === 1) {
      const f = meta.fields[idCols[0]].field;
      return { [f]: camelRow[f] };
    }
    if (meta.compositeId && meta.compositeId.length > 0) {
      const key = meta.compositeId.join("_");
      const inner: Record<string, any> = {};
      for (const f of meta.compositeId) inner[f] = camelRow[f];
      return { [key]: inner };
    }
    for (const set of meta.uniques) {
      if (set.every((f) => camelRow[f] !== undefined && camelRow[f] !== null)) {
        if (set.length === 1) return { [set[0]]: camelRow[set[0]] };
        const key = set.join("_");
        const inner: Record<string, any> = {};
        for (const f of set) inner[f] = camelRow[f];
        return { [key]: inner };
      }
    }
    return null;
  }

  private async execute(): Promise<any> {
    if (this.errorOut) {
      return { data: this.isSingle ? null : [], error: this.errorOut };
    }
    if (this.poisoned || !this.meta) {
      return this.gracefulEmpty();
    }
    try {
      const delegate = this.delegate();
      let result: any[] = [];
      let count: number | null = null;

      if (this.action === "select") {
        const where = this.where();
        const orderBy = this.orderBy.length > 0 ? this.orderBy : undefined;
        if (this.headOnly && this.postFilters.length === 0) {
          // HEAD request: count only, never fetch rows.
          if (this.wantCount) count = await delegate.count({ where });
          return this.finish([], count);
        }
        if (this.postFilters.length > 0) {
          let rows = await delegate.findMany({
            where,
            orderBy,
            take: MAX_UNBOUNDED_ROWS,
          });
          if (rows.length >= MAX_UNBOUNDED_ROWS) {
            console.error(
              `[db] REG-84 ceiling hit on ${this.tableName}: post-filtered select reached ${MAX_UNBOUNDED_ROWS} rows; results may be truncated. Add an explicit limit/range at the call site.`
            );
          }
          for (const pf of this.postFilters) rows = rows.filter(pf);
          if (this.wantCount) count = rows.length;
          if (this.limitCount) {
            rows = rows.slice(0, this.limitCount);
          } else if (this.rangeStart !== undefined && this.rangeEnd !== undefined) {
            rows = rows.slice(this.rangeStart, this.rangeEnd + 1);
          }
          result = rows.map((r: any) => this.toSnakeRow(r));
        } else {
          const args: any = { where, orderBy };
          if (this.limitCount) {
            args.take = this.limitCount;
          } else if (this.rangeStart !== undefined && this.rangeEnd !== undefined) {
            args.skip = this.rangeStart;
            args.take = this.rangeEnd - this.rangeStart + 1;
          } else {
            // REG-84: caller asked for "everything" — bound it.
            args.take = MAX_UNBOUNDED_ROWS;
          }
          const rows = await delegate.findMany(args);
          if (
            !this.limitCount &&
            this.rangeStart === undefined &&
            rows.length >= MAX_UNBOUNDED_ROWS
          ) {
            console.error(
              `[db] REG-84 ceiling hit on ${this.tableName}: unbounded select reached ${MAX_UNBOUNDED_ROWS} rows; results may be truncated. Add an explicit limit/range at the call site.`
            );
          }
          result = rows.map((r: any) => this.toSnakeRow(r));
          if (this.wantCount) {
            count = await delegate.count({ where });
          }
        }
        result = this.applyRowFixups(result);
        result = await this.attachRelations(result);
        return this.finish(result, count);
      }

      if (this.action === "insert" || this.action === "upsert") {
        const dataArray = Array.isArray(this.payload)
          ? this.payload.map((p: any) => ({ ...p }))
          : [{ ...this.payload }];
        if (dataArray.length === 0) return { data: [], error: null };

        const noIdTables = ["product_categories", "role_permissions"];
        for (const item of dataArray) {
          applyInsertSanitizers(this.tableName, item);
          if (!noIdTables.includes(this.tableName) && item.id === undefined) {
            item.id = randomUUID();
          }
        }

        if (this.action === "upsert" && this.onConflictCols) {
          const conflictCols = this.onConflictCols
            .split(",")
            .map((c: string) => assertIdent(c.trim(), "column"));
          if (conflictCols.some((c) => !this.meta!.fields[c])) {
            return this.gracefulEmpty();
          }
          // Upserts are executed per row.
          const outRows: any[] = [];
          for (const item of dataArray) {
            const eqWhere: Record<string, any> = {};
            let hasKey = false;
            for (const c of conflictCols) {
              if (item[c] !== undefined && item[c] !== null) {
                const fm = this.meta!.fields[c];
                const v = coerceValue(fm, item[c]);
                if (v !== INVALID) {
                  eqWhere[fm.field] = v;
                  hasKey = true;
                }
              }
            }
            let saved: any = null;
            if (hasKey) {
              saved = await delegate.findFirst({ where: eqWhere });
            }
            if (saved) {
              const updatePayload: Record<string, any> = {};
              for (const k of Object.keys(item)) {
                if (k !== "id" && !conflictCols.includes(k)) updatePayload[k] = item[k];
              }
              const data = this.toCamelData(updatePayload);
              if (data === null) return this.gracefulEmpty();
              const pk = this.pkWhere(saved);
              if (pk) {
                saved = await delegate.update({ where: pk, data });
              } else {
                await delegate.updateMany({ where: eqWhere, data });
                saved = await delegate.findFirst({ where: eqWhere });
              }
              outRows.push(saved);
            } else {
              const data = this.toCamelData(item);
              if (data === null) return this.gracefulEmpty();
              saved = await delegate.create({ data });
              outRows.push(saved);
            }
          }
          result = outRows.map((r: any) => this.toSnakeRow(r));
          result = this.applyRowFixups(result);
          return this.finish(result, null);
        }

        const camelRows: Record<string, any>[] = [];
        for (const item of dataArray) {
          const data = this.toCamelData(item);
          if (data === null) return this.gracefulEmpty();
          camelRows.push(data);
        }

        if (this.action === "upsert") {
          // ON CONFLICT DO NOTHING semantics.
          try {
            const created =
              typeof delegate.createManyAndReturn === "function"
                ? await delegate.createManyAndReturn({ data: camelRows })
                : await prisma.$transaction(
                    camelRows.map((data) => delegate.create({ data }))
                  );
            result = (created as any[]).map((r: any) => this.toSnakeRow(r));
          } catch (e: any) {
            if (e?.code === "P2002") {
              result = [];
            } else {
              throw e;
            }
          }
          result = this.applyRowFixups(result);
          return this.finish(result, null);
        }

        const created =
          typeof delegate.createManyAndReturn === "function"
            ? await delegate.createManyAndReturn({ data: camelRows })
            : await prisma.$transaction(
                camelRows.map((data) => delegate.create({ data }))
              );
        result = (created as any[]).map((r: any) => this.toSnakeRow(r));
        result = this.applyRowFixups(result);
        return this.finish(result, null);
      }

      if (this.action === "update") {
        const payloadCopy = { ...this.payload };
        applyUpdateSanitizers(this.tableName, payloadCopy);
        const keys = Object.keys(payloadCopy);
        if (keys.length === 0) {
          return {
            data: this.isSingle ? null : [],
            error: { code: "42601", message: "syntax error" },
          };
        }
        if (keys.some((k) => !this.meta!.fields[k])) {
          return this.gracefulEmpty();
        }
        const data = this.toCamelData(payloadCopy);
        if (data === null) return this.gracefulEmpty();

        const where = this.where();
        const existing = await delegate.findMany({ where });
        if (existing.length === 0) return this.finish([], null);

        // Preserve @updatedAt columns the caller did not set: the raw-SQL
        // behaviour this replaces never touched them implicitly.
        const updatedAtCol = Object.keys(this.meta!.fields).find(
          (c) => this.meta!.fields[c].updatedAt
        );
        const updatedRows: any[] = [];
        for (const row of existing) {
          const rowData = { ...data };
          if (updatedAtCol) {
            const f = this.meta!.fields[updatedAtCol].field;
            if (!(f in rowData)) rowData[f] = row[f];
          }
          const pk = this.pkWhere(row);
          if (pk) {
            updatedRows.push(await delegate.update({ where: pk, data: rowData }));
          } else {
            const idWhere: Record<string, any> = {};
            for (const c of Object.keys(this.meta!.fields)) {
              const f = this.meta!.fields[c].field;
              if (this.meta!.fields[c].id || this.meta!.fields[c].unique) {
                idWhere[f] = row[f];
              }
            }
            await delegate.updateMany({ where: idWhere, data: rowData });
            updatedRows.push(
              await delegate.findFirst({ where: idWhere })
            );
          }
        }
        result = updatedRows.filter(Boolean).map((r: any) => this.toSnakeRow(r));
        result = this.applyRowFixups(result);
        return this.finish(result, null);
      }

      if (this.action === "delete") {
        const where = this.where();
        const existing = await delegate.findMany({ where });
        if (existing.length > 0) {
          await delegate.deleteMany({ where });
        }
        result = existing.map((r: any) => this.toSnakeRow(r));
        result = this.applyRowFixups(result);
        return this.finish(result, null);
      }

      return this.finish([], null);
    } catch (e: any) {
      if (
        e?.code === "P2021" ||
        e?.code === "P2022" ||
        e?.code === "42P01" ||
        (typeof e?.message === "string" && e.message.includes("does not exist"))
      ) {
        return { data: this.isSingle ? null : [], error: null, count: 0 };
      }
      return {
        data: this.isSingle ? null : [],
        error: { code: e?.code || "42P01", message: e?.message || String(e) },
      };
    }
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    if (!this.execPromise) this.execPromise = this.execute();
    return this.execPromise.then(onfulfilled, onrejected);
  }
}
