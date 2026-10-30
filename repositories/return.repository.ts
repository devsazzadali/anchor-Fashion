// ============================================================================
// Return Repository
// ============================================================================

import { createAdminDbClient } from "@/lib/db/client";
import { prisma } from "@/lib/prisma";
import {
  ReturnRequest,
  ReturnItem,
  ReturnWithItems,
  ReturnFilters,
  PaginatedResult,
} from "@/types/shipping.types";

export class ReturnRepository {
  private getClient() {
    return createAdminDbClient();
  }

  /**
   * Create a return with its items.
   */
  async createReturn(
    data: Omit<Partial<ReturnRequest>, "id" | "created_at" | "updated_at">,
    items: Omit<Partial<ReturnItem>, "id" | "return_id" | "created_at">[]
  ): Promise<ReturnWithItems> {
    const db = this.getClient();

    const { data: ret, error } = await db
      .from("returns")
      .insert(data as any)
      .select()
      .single();

    if (error) throw new Error(`Create return failed: ${error.message}`);

    if (items.length > 0) {
      const { error: itemError } = await db
        .from("return_items")
        .insert(items.map((item) => ({ ...item, return_id: ret.id })) as any);

      if (itemError) console.error("Failed to insert return items:", itemError);
    }

    return this.getReturnWithItems(ret.id) as Promise<ReturnWithItems>;
  }

  /**
   * Update return fields.
   */
  async updateReturn(
    id: string,
    data: Partial<ReturnRequest> & { [key: string]: any }
  ): Promise<ReturnRequest> {
    const db = this.getClient();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    let query = db.from("returns").update(data as any);
    query = isUuid ? query.eq("id", id) : query.eq("return_number", id);

    const { data: updated, error } = await query
      .select()
      .maybeSingle();

    if (error) throw new Error(`Update return failed: ${error.message}`);
    return updated as ReturnRequest;
  }

  /**
   * Atomic state transition: updates status only if current status is in allowed array.
   * Automatically logs to order_notes.
   */
  async atomicUpdateStatus(
    id: string,
    allowedCurrentStatuses: string[],
    data: Partial<ReturnRequest> & { status: string },
    actorId?: string
  ): Promise<ReturnRequest> {
    const db = this.getClient();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    
    // Support both lowercase and UPPERCASE to prevent casing mismatches
    const caseInsensitiveStatuses = Array.from(
      new Set([
        ...allowedCurrentStatuses.map((s) => s.toLowerCase()),
        ...allowedCurrentStatuses.map((s) => s.toUpperCase()),
      ])
    );
    
    let query = db.from("returns").update(data as any);
    query = isUuid ? query.eq("id", id) : query.eq("return_number", id);

    const { data: updated, error } = await query
      .in("status", caseInsensitiveStatuses)
      .select()
      .maybeSingle();

    if (error) throw new Error(`Atomic status update failed: ${error.message}`);
    if (!updated) throw new Error(`Invalid state transition. Return ${id} is not in an allowed state: ${allowedCurrentStatuses.join(", ")}`);
    
    // Audit Log
    if (updated.order_id) {
      try {
        const isActorUuid = actorId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorId);
        await db.from("order_notes").insert({
          order_id: updated.order_id,
          author_id: isActorUuid ? actorId : null,
          note: `[RETURN] Status changed to '${data.status}' for Return #${updated.return_number}`,
          is_customer_visible: false,
        });
      } catch (noteErr) {
        console.warn("[atomicUpdateStatus] Note logging skipped:", noteErr);
      }
    }

    return updated as ReturnRequest;
  }

  /**
   * Get return by ID.
   */
  async getReturnById(id: string): Promise<ReturnRequest | null> {
    const db = this.getClient();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    const query = db.from("returns").select("*");
    const { data, error } = await (isUuid
      ? query.eq("id", id)
      : query.eq("return_number", id)
    ).maybeSingle();

    if (error) throw new Error(`Get return failed: ${error.message}`);
    return data as ReturnRequest | null;
  }

  /**
   * Get return with items.
   *
   * S5-9: the row builder never resolves the `items:return_items(*)`
   * embed (same disease as ticket_messages in round 5), so the detail
   * payload arrived with NO items at all and the admin "Return Items"
   * card rendered empty even though return_items holds the rows. The
   * embed is therefore not used: the return row is fetched plainly and
   * its items are loaded explicitly and enriched (see
   * attachItemsAndRefundState).
   */
  async getReturnWithItems(id: string): Promise<ReturnWithItems | null> {
    const db = this.getClient();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    const query = db.from("returns").select("*");
    const { data, error } = await (isUuid
      ? query.eq("id", id)
      : query.eq("return_number", id)
    ).maybeSingle();

    if (error)
      throw new Error(`Get return with items failed: ${error.message}`);
    if (!data) return null;
    return this.attachItemsAndRefundState(data as any);
  }

  /**
   * Attach a return's items (with display fields) and its refund state.
   *
   * Display fields: return_items physically stores only ids + quantity +
   * reason/condition/restocked — sku and product_name live on the linked
   * order item (variant as fallback), and there is no per-item refund
   * column, so each item's refund is its proportional share of the
   * return's refund_amount by line value (the full amount when there is
   * a single item — the overwhelmingly common case).
   *
   * Refund state: the returns table has NO refund_status / refund_method
   * columns (the write sanitizer drops them), so the settled state is
   * derived from what IS persisted: a return is settled when its status
   * reached "completed", and the settlement method is recorded in the
   * notes text written at settlement ("Refund settled (WALLET) by
   * admin…") — with the wallet ledger as corroboration for WALLET.
   */
  private async attachItemsAndRefundState(
    ret: Record<string, any>
  ): Promise<ReturnWithItems> {
    const db = this.getClient();

    const { data: rawItems } = await db
      .from("return_items")
      .select("*")
      .eq("return_id", ret.id)
      .order("created_at", { ascending: true });

    const rows: any[] = rawItems ?? [];

    // Resolve order items / variants for display fields in bulk.
    const orderItemIds = rows.map((r) => r.order_item_id).filter(Boolean);
    const orderItems = orderItemIds.length
      ? await prisma.orderItem.findMany({
          where: { id: { in: orderItemIds } },
          select: {
            id: true,
            sku: true,
            productName: true,
            variantId: true,
            unitPrice: true,
            totalPrice: true,
          },
        })
      : [];
    const orderItemById = new Map(orderItems.map((o) => [o.id, o]));

    const variantIds = Array.from(
      new Set(
        rows
          .map((r) => r.variant_id || orderItemById.get(r.order_item_id)?.variantId)
          .filter(Boolean)
      )
    ) as string[];
    const variants = variantIds.length
      ? await prisma.variant.findMany({
          where: { id: { in: variantIds } },
          select: { id: true, sku: true },
        })
      : [];
    const variantById = new Map(variants.map((v) => [v.id, v]));

    const lineValue = (r: any): number => {
      const oi = r.order_item_id ? orderItemById.get(r.order_item_id) : null;
      if (oi) {
        const total = Number(oi.totalPrice ?? 0);
        if (total > 0) return total;
        return Number(oi.unitPrice ?? 0) * (Number(r.quantity) || 1);
      }
      return 0;
    };
    const totalLineValue = rows.reduce((sum, r) => sum + lineValue(r), 0);
    const refundTotal = Number(ret.refund_amount ?? 0);

    const items = rows.map((r) => {
      const oi = r.order_item_id ? orderItemById.get(r.order_item_id) : null;
      const variant = variantById.get(r.variant_id || oi?.variantId || "");
      let itemRefund: number;
      if (rows.length <= 1) {
        itemRefund = refundTotal;
      } else if (totalLineValue > 0) {
        itemRefund = Number(
          ((lineValue(r) / totalLineValue) * refundTotal).toFixed(2)
        );
      } else {
        itemRefund = Number((refundTotal / rows.length).toFixed(2));
      }
      return {
        ...r,
        sku: r.sku ?? oi?.sku ?? variant?.sku ?? null,
        product_name: r.product_name ?? oi?.productName ?? null,
        refund_amount: itemRefund,
      };
    });

    // ── Refund state derivation (see docstring) ──────────────────────
    const status = String(ret.status || "").toLowerCase();
    let refundStatus: string | null = null;
    if (status === "completed") refundStatus = "PROCESSED";
    else if (
      ["requested", "approved", "pickup_scheduled", "picked_up", "in_transit", "received", "inventory_synced"].includes(status)
    ) {
      refundStatus = "PENDING";
    }

    let refundMethod: string | null =
      typeof ret.refund_method === "string" ? ret.refund_method : null;
    if (!refundMethod && typeof ret.notes === "string") {
      const m = ret.notes.match(/Refund settled \(([^)]+)\)/i);
      if (m) refundMethod = m[1].toUpperCase();
    }
    // Round 8: returns created after the write-path alignment persist
    // the customer-chosen method as a notes line at creation time
    // (there is no refund_method column — the sanitizer dropped it), so
    // an unsettled return also reports its method truthfully.
    if (!refundMethod && typeof ret.notes === "string") {
      const m = ret.notes.match(/Refund method: ([A-Z_]+)/i);
      if (m) refundMethod = m[1].toUpperCase();
    }
    if (!refundMethod && ret.return_number) {
      try {
        const credits = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
          `SELECT COUNT(*)::int AS n FROM wallet_transactions
           WHERE type = 'CREDIT' AND description ILIKE $1`,
          `%${ret.return_number}%`
        );
        if (Number(credits?.[0]?.n ?? 0) > 0) refundMethod = "WALLET";
      } catch {
        // Wallet ledger unavailable — the notes derivation above stands.
      }
    }

    return {
      ...ret,
      items,
      refund_status: ret.refund_status ?? refundStatus,
      refund_method: refundMethod,
    } as ReturnWithItems;
  }

  /**
   * Get returns by order.
   */
  async getReturnsByOrderId(orderId: string): Promise<ReturnRequest[]> {
    const db = this.getClient();

    const { data, error } = await db
      .from("returns")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(`Get returns by order failed: ${error.message}`);
    return (data ?? []) as ReturnRequest[];
  }

  /**
   * List returns with pagination and filters.
   */
  async listReturns(
    filters: ReturnFilters
  ): Promise<PaginatedResult<ReturnRequest>> {
    const db = this.getClient();
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    // Only join orders table when filtering by branchId
    let query = filters.branchId
      ? db.from("returns").select("*, orders!inner(branch_id)", { count: "exact" })
      : db.from("returns").select("*", { count: "exact" });

    if (filters.status) {
      query = query.or(`status.eq.${filters.status.toLowerCase()},status.eq.${filters.status.toUpperCase()}`);
    }
    if (filters.dateFrom) query = query.gte("created_at", filters.dateFrom);
    if (filters.dateTo) query = query.lte("created_at", filters.dateTo);
    if (filters.search) {
      query = query.or(`return_number.ilike.%${filters.search}%`);
    }
    if (filters.branchId) {
      query = query.eq("orders.branch_id", filters.branchId);
    }

    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) throw new Error(`List returns failed: ${error.message}`);

    return {
      data: ((data ?? []) as unknown) as ReturnRequest[],
      total: count ?? 0,
      page,
      limit,
      totalPages: Math.ceil((count ?? 0) / limit),
    };
  }

  /**
   * Get returns by customer ID.
   */
  async getReturnsByCustomerId(customerId: string): Promise<ReturnWithItems[]> {
    const db = this.getClient();

    // S5-9: no embed (never resolved — see getReturnWithItems); items
    // and refund state are attached explicitly per return.
    const { data, error } = await db
      .from("returns")
      .select("*")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(`Get returns by customer failed: ${error.message}`);
    const rows = (data ?? []) as Record<string, any>[];
    return Promise.all(rows.map((r) => this.attachItemsAndRefundState(r)));
  }

  /**
   * Get active return items for an order (excluding rejected/cancelled).
   * Used to check already requested/returned quantities.
   *
   * S5-flag / S6-round-8: this used the `items:return_items(*)` embed,
   * which the row builder never resolves — the query always came back
   * with no items, so eligibility accounting believed NOTHING had ever
   * been returned and a fully-returned item could be returned again.
   * Replaced with the same explicit two-step fetch
   * attachItemsAndRefundState uses: returns for the order first, then
   * their items by return_id.
   */
  async getActiveReturnItemsForOrder(
    orderId: string
  ): Promise<Array<ReturnItem & { return_status: string }>> {
    const db = this.getClient();

    const { data: rets, error } = await db
      .from("returns")
      .select("id, status")
      .eq("order_id", orderId)
      .not("status", "in", "('rejected','cancelled')");

    if (error) {
      console.error("Error fetching active return items for order:", error);
      return [];
    }

    const rows = (rets ?? []) as Array<{ id: string; status: string }>;
    if (rows.length === 0) return [];

    const statusByReturnId = new Map(rows.map((r) => [r.id, r.status]));
    const { data: items, error: itemError } = await db
      .from("return_items")
      .select("*")
      .in("return_id", rows.map((r) => r.id));

    if (itemError) {
      console.error("Error fetching return items for order:", itemError);
      return [];
    }

    return ((items ?? []) as any[]).map((it) => ({
      ...it,
      return_status: statusByReturnId.get(it.return_id) ?? "",
    }));
  }

  /**
   * Claim refund processing for a return (replaces
   * atomicUpdateRefundStatus, round 8).
   *
   * The old method filtered on a `refund_status` column the returns
   * table does not have: the sanitizer dropped it from the payload and
   * the `.or("refund_status.in.(…)")` condition matched nothing, so
   * EVERY refund process died at the lock with "already being
   * processed". The claim is now a compare-and-swap on real columns:
   * the update lands only while the return's status is still a
   * pre-settle status, and it stamps a marker line into `notes` (plus
   * updated_at). A second caller — or any caller after settlement moved
   * the return to "completed" — matches zero rows and gets the throw.
   */
  async claimRefundProcessing(
    id: string,
    actorId?: string
  ): Promise<ReturnRequest> {
    const db = this.getClient();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    const current = await this.getReturnById(id);
    if (!current) throw new Error(`Return ${id} not found`);

    const PRE_SETTLE = [
      "requested",
      "approved",
      "pickup_scheduled",
      "picked_up",
      "in_transit",
      "received",
      "inventory_synced",
    ];
    const caseInsensitiveStatuses = Array.from(
      new Set([
        ...PRE_SETTLE,
        ...PRE_SETTLE.map((s) => s.toUpperCase()),
      ])
    );

    const marker = "Refund processing claimed.";
    const existingNotes = ((current as any).notes as string | null) || "";
    const notes = existingNotes.includes(marker)
      ? existingNotes
      : [existingNotes.trim(), marker].filter(Boolean).join("\n");

    let query = db
      .from("returns")
      .update({ notes, updated_at: new Date().toISOString() } as any);
    query = isUuid ? query.eq("id", id) : query.eq("return_number", id);

    const { data: updated, error } = await query
      .in("status", caseInsensitiveStatuses)
      .select()
      .maybeSingle();

    if (error) throw new Error(`Refund claim failed: ${error.message}`);
    if (!updated)
      throw new Error(`Refund already processed or locked by another transaction.`);

    if (updated.order_id) {
      try {
        const isActorUuid =
          actorId &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorId);
        await db.from("order_notes").insert({
          order_id: updated.order_id,
          author_id: isActorUuid ? actorId : null,
          note: `[RETURN] Refund processing claimed for Return #${updated.return_number}`,
          is_customer_visible: false,
        });
      } catch (noteErr) {
        console.warn("[claimRefundProcessing] Note logging skipped:", noteErr);
      }
    }

    return updated as ReturnRequest;
  }

  /**
   * Get return items for a return.
   */
  async getReturnItems(returnId: string): Promise<ReturnItem[]> {
    const db = this.getClient();

    const { data, error } = await db
      .from("return_items")
      .select("*")
      .eq("return_id", returnId);

    if (error) throw new Error(`Get return items failed: ${error.message}`);
    return (data ?? []) as ReturnItem[];
  }

  /**
   * Mark a return item as restocked.
   */
  async markItemRestocked(returnItemId: string): Promise<void> {
    const db = this.getClient();
    await db
      .from("return_items")
      .update({ restocked: true } as any)
      .eq("id", returnItemId);
  }
}

