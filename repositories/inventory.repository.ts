import { createAdminDbClient } from "@/lib/db/client";
import { prisma } from "@/lib/prisma";
import { InventoryLevel, InventoryMovement } from "@/types/inventory.types";

export class InventoryRepository {
  private getAdminClient() {
    return createAdminDbClient();
  }

  /**
   * Get stock level for a variant across all warehouses or a specific one.
   */
  async getStockLevel(
    variantId: string,
    warehouseId?: string
  ): Promise<InventoryLevel[]> {
    const db = this.getAdminClient();
    let query = db
      .from("inventory_levels")
      .select("*")
      .eq("variant_id", variantId);

    if (warehouseId) {
      query = query.eq("warehouse_id", warehouseId);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to get stock level: ${error.message}`);
    return data as InventoryLevel[];
  }

  /**
   * Adjust stock via an RPC function or a standard update (since we need atomic operations).
   */
  async reserveStock(
    variantId: string,
    warehouseId: string,
    quantity: number
  ): Promise<void> {
    const db = this.getAdminClient();
    
    if (quantity <= 0) {
      throw new Error(`Quantity must be greater than zero`);
    }

    const { error } = await db.rpc("atomic_reserve_stock", {
      p_variant_id: variantId,
      p_warehouse_id: warehouseId,
      p_quantity: quantity,
    });

    if (error) {
      throw new Error(`Failed to reserve stock: ${error.message}`);
    }
  }

  async releaseStock(
    variantId: string,
    warehouseId: string,
    quantity: number
  ): Promise<void> {
    const db = this.getAdminClient();

    if (quantity <= 0) {
      throw new Error(`Quantity must be greater than zero`);
    }

    const { error } = await db.rpc("atomic_release_stock", {
      p_variant_id: variantId,
      p_warehouse_id: warehouseId,
      p_quantity: quantity,
    });

    if (error) {
      throw new Error(`Failed to release stock: ${error.message}`);
    }
  }

  async reduceStock(
    variantId: string,
    warehouseId: string,
    quantity: number,
    fromReserved = true
  ): Promise<void> {
    const db = this.getAdminClient();

    if (quantity <= 0) {
      throw new Error(`Quantity must be greater than zero`);
    }

    const { error } = await db.rpc("atomic_reduce_stock", {
      p_variant_id: variantId,
      p_warehouse_id: warehouseId,
      p_quantity: quantity,
      p_from_reserved: fromReserved,
    });

    if (error) {
      throw new Error(`Failed to reduce stock: ${error.message}`);
    }
  }

  /**
   * Record an inventory movement (audit log).
   */
  async recordMovement(
    movement: any
  ): Promise<void> {
    const db = this.getAdminClient();
    const rawReason =
      movement.reason ||
      movement.notes ||
      movement.reason_code ||
      movement.movement_type ||
      "Stock Adjustment";
    const rawReasonCode = movement.reason_code || movement.movement_type || null;

    const payload = {
      variant_id: movement.variant_id,
      warehouse_id: movement.warehouse_id,
      quantity_change:
        movement.quantity_change !== undefined
          ? movement.quantity_change
          : movement.quantity !== undefined
          ? movement.quantity
          : 0,
      reason: String(rawReason).slice(0, 50),
      reason_code: rawReasonCode ? String(rawReasonCode).slice(0, 50) : null,
      reference_id: movement.reference_id || null,
      reference_type: movement.reference_type || null,
      // S4-9: callers that know the real before/after quantities pass them
      // through; without them the DB layer defaults previous=0 / new=quantity,
      // which corrupts the audit trail's quantity columns.
      previous_quantity: movement.previous_quantity,
      new_quantity: movement.new_quantity,
      to_warehouse_id: movement.to_warehouse_id || null,
      from_bin_id: movement.from_bin_id || null,
      to_bin_id: movement.to_bin_id || null,
      user_id: movement.user_id || null,
    };

    try {
      const { error } = await db
        .from("stock_movements")
        .insert(payload);
      if (error) {
        console.warn(`Failed to record stock movement: ${error.message}`);
      }
    } catch (e: any) {
      console.warn("Could not insert stock_movements log:", e?.message);
    }
  }

  /**
   * Get all inventory levels (paginated)
   */
  async getAllInventoryLevels(
    page: number = 1,
    limit: number = 20
  ): Promise<{ data: InventoryLevel[]; total: number }> {
    const db = this.getAdminClient();
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, error, count } = await db
      .from("inventory_levels")
      .select("*", { count: "exact" })
      .range(from, to);

    if (error)
      throw new Error(`Failed to fetch inventory levels: ${error.message}`);

    return {
      data: (data ?? []) as InventoryLevel[],
      total: count ?? 0,
    };
  }

  /**
   * Get inventory dashboard data (with SKU, Product Name, and Warehouse Name)
   */
  async getInventoryDashboard(limit = 20, search?: string) {
    try {
      const trimmedSearch = search?.trim();
      const whereClause = trimmedSearch
        ? {
            OR: [
              { variant: { sku: { contains: trimmedSearch, mode: "insensitive" as const } } },
              { variant: { product: { name: { contains: trimmedSearch, mode: "insensitive" as const } } } },
            ],
          }
        : undefined;

      const levels = await prisma.inventoryLevel.findMany({
        where: whereClause,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          variant: {
            include: {
              product: {
                select: { name: true },
              },
            },
          },
          warehouse: {
            select: { name: true },
          },
        },
      });

      const processed = levels.map((item) => {
        const available = item.quantityAvailable ?? 0;
        const reserved = item.quantityReserved ?? 0;
        const reorderPoint = item.reorderPoint ?? 0;

        let status: "In Stock" | "Low Stock" | "Out of Stock" = "In Stock";
        if (available <= 0) {
          status = "Out of Stock";
        } else if (available <= reorderPoint) {
          status = "Low Stock";
        }

        return {
          id: item.id,
          sku: item.variant?.sku || "Unknown SKU",
          name: item.variant?.product?.name || "Anchor Fashion Apparel",
          warehouse: item.warehouse?.name || "Main Central Warehouse",
          available,
          reserved,
          status,
        };
      });

      // Stats must cover ALL matching levels, not just the page being
      // displayed — previously the headline "Total Items in Stock" summed
      // only the first `limit` rows (544 shown vs 1,759 actually in stock).
      const allLevels = await prisma.inventoryLevel.findMany({
        where: whereClause,
        select: {
          quantityAvailable: true,
          quantityReserved: true,
          reorderPoint: true,
        },
      });
      const totalInStock = allLevels.reduce(
        (acc, l) => acc + (l.quantityAvailable ?? 0),
        0
      );
      const lowStockCount = allLevels.filter((l) => {
        const a = l.quantityAvailable ?? 0;
        return a > 0 && a <= (l.reorderPoint ?? 0);
      }).length;
      const outOfStockCount = allLevels.filter(
        (l) => (l.quantityAvailable ?? 0) <= 0
      ).length;

      return {
        items: processed,
        stats: {
          totalItems: totalInStock,
          lowStock: lowStockCount,
          outOfStock: outOfStockCount,
        },
      };
    } catch (error) {
      console.error("Error fetching inventory dashboard via Prisma:", error);
      return {
        items: [],
        stats: {
          totalItems: 0,
          lowStock: 0,
          outOfStock: 0,
        },
      };
    }
  }

  /**
   * Adjust stock manually
   */
  async adjustStock(
    inventoryId: string,
    newAvailable: number,
    newReserved: number,
    reason: string
  ): Promise<void> {
    const db = this.getAdminClient();

    const { data: inv, error: fetchError } = await db
      .from("inventory_levels")
      .select("*")
      .eq("id", inventoryId)
      .single();

    if (fetchError || !inv) throw new Error("Inventory not found");

    const { error } = await db
      .from("inventory_levels")
      .update({
        quantity_available: newAvailable,
        quantity_reserved: newReserved,
      })
      .eq("id", inventoryId);

    if (error) throw new Error(`Failed to adjust stock: ${error.message}`);

    // Record movement
    await this.recordMovement({
      variant_id: inv.variant_id,
      warehouse_id: inv.warehouse_id,
      movement_type: "ADJUST",
      quantity: newAvailable - inv.quantity_available, // Net change
      reason_code: reason,
      notes: `Adjusted from ${inv.quantity_available} to ${newAvailable}`,
    });
  }

  /**
   * Get stock movements (paginated)
   */
  async getMovements(
    page: number = 1,
    limit: number = 20,
    warehouseId?: string,
    variantId?: string
  ): Promise<{ data: InventoryMovement[]; total: number }> {
    const db = this.getAdminClient();
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = db
      .from("stock_movements")
      .select("*", { count: "exact" });
    if (warehouseId) query = query.eq("warehouse_id", warehouseId);
    if (variantId) query = query.eq("variant_id", variantId);

    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) throw new Error(`Failed to fetch movements: ${error.message}`);

    return {
      data: (data ?? []) as InventoryMovement[],
      total: count ?? 0,
    };
  }

  /**
   * Transfer stock between warehouses
   */
  async transferStock(
    variantId: string,
    fromWarehouseId: string,
    toWarehouseId: string,
    quantity: number,
    reason: string,
    notes?: string,
    userId?: string
  ): Promise<void> {
    if (quantity <= 0) {
      throw new Error(`Quantity must be greater than zero`);
    }

    if (fromWarehouseId === toWarehouseId) {
      throw new Error(`Source and destination warehouse must be different`);
    }

    // created_by is a uuid column; only stamp well-formed ids.
    const createdBy =
      userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)
        ? userId
        : null;

    // Perform fully atomic transfer using Prisma transaction
    await prisma.$transaction(async (tx) => {
      // 1. Check source warehouse inventory
      const sourceInv = await tx.inventoryLevel.findFirst({
        where: { variantId, warehouseId: fromWarehouseId },
      });

      const sourceAvail = sourceInv ? sourceInv.quantityAvailable : 0;
      if (!sourceInv || sourceAvail < quantity) {
        throw new Error(
          `Insufficient stock in source warehouse. Available: ${sourceAvail}, Requested: ${quantity}`
        );
      }

      // 2. Decrement source inventory
      const newSourceAvail = sourceAvail - quantity;
      await tx.inventoryLevel.update({
        where: { id: sourceInv.id },
        data: {
          quantityAvailable: newSourceAvail,
          updatedAt: new Date(),
        },
      });

      // 3. Increment or insert destination inventory
      const destInv = await tx.inventoryLevel.findFirst({
        where: { variantId, warehouseId: toWarehouseId },
      });

      const destAvail = destInv ? destInv.quantityAvailable : 0;
      const newDestAvail = destAvail + quantity;

      if (destInv) {
        await tx.inventoryLevel.update({
          where: { id: destInv.id },
          data: {
            quantityAvailable: newDestAvail,
            updatedAt: new Date(),
          },
        });
      } else {
        await tx.inventoryLevel.create({
          data: {
            variantId,
            warehouseId: toWarehouseId,
            quantityAvailable: quantity,
            quantityReserved: 0,
            reorderPoint: 5,
          },
        });
      }

      // 4. Record movements (S4-9: stamp the acting user + transfer
      // reference so the audit log shows who moved what, where).
      await tx.stockMovement.create({
        data: {
          variantId,
          warehouseId: fromWarehouseId,
          movementType: "TRANSFER_OUT",
          quantity: -quantity,
          previousQuantity: sourceAvail,
          newQuantity: newSourceAvail,
          referenceType: "TRANSFER",
          referenceId: toWarehouseId,
          notes: notes || `Transferred to warehouse ${toWarehouseId}`,
          createdBy,
        },
      });

      await tx.stockMovement.create({
        data: {
          variantId,
          warehouseId: toWarehouseId,
          movementType: "TRANSFER_IN",
          quantity: quantity,
          previousQuantity: destAvail,
          newQuantity: newDestAvail,
          referenceType: "TRANSFER",
          referenceId: fromWarehouseId,
          notes: notes || `Received from warehouse ${fromWarehouseId}`,
          createdBy,
        },
      });
    });
  }

  // --- Audits ---

  /**
   * Attach warehouse names to audit rows. The DB layer does not resolve
   * embedded relations (`warehouse:warehouses(...)` selects come back
   * without the embed), so names are joined manually — both the singular
   * `warehouse` key (perform page) and the plural `warehouses` key
   * (audits list client) are populated.
   */
  private async attachAuditWarehouses(rows: any[]): Promise<any[]> {
    if (!rows || rows.length === 0) return rows;
    const db = this.getAdminClient();
    const ids = [...new Set(rows.map((r: any) => r.warehouse_id).filter(Boolean))];
    if (ids.length === 0) return rows;
    const { data: warehouses } = await db
      .from("warehouses")
      .select("id, name")
      .in("id", ids);
    const byId = new Map<string, any>((warehouses || []).map((w: any) => [w.id, w] as [string, any]));
    return rows.map((r: any) => {
      const w = byId.get(r.warehouse_id);
      const wh = w ? { id: w.id, name: w.name } : null;
      return { ...r, warehouse: wh, warehouses: wh };
    });
  }

  async getAudits(): Promise<any[]> {
    const db = this.getAdminClient();
    const { data, error } = await db
      .from("inventory_audits")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw new Error(`Failed to get audits: ${error.message}`);
    return this.attachAuditWarehouses(data || []);
  }

  async getAuditById(id: string): Promise<any> {
    const db = this.getAdminClient();
    const { data, error } = await db
      .from("inventory_audits")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw new Error(`Failed to get audit: ${error.message}`);
    }
    if (!data) return null;
    const [withWh] = await this.attachAuditWarehouses([data]);
    return withWh;
  }

  async createAudit(auditData: any): Promise<any> {
    const db = this.getAdminClient();
    // S4-7: inventory_audits' real columns are only id, warehouse_id,
    // status, notes, created_by, created_at. The previous payload always
    // carried `blind_count` (and optionally `zone_id` / `assigned_to`) —
    // the DB layer silently discards ANY write containing an unknown
    // column, so scheduling toasted "success" while nothing persisted.
    // Only real columns are sent now; the scheduled date and blind-count
    // choice are preserved in `notes` (the table has no columns for them).
    const noteParts: string[] = [];
    if (auditData.notes) noteParts.push(String(auditData.notes));
    if (auditData.scheduled_date) noteParts.push(`Scheduled for ${auditData.scheduled_date}`);
    if (auditData.blind_count !== undefined) {
      noteParts.push(auditData.blind_count ? "Blind count" : "Open count");
    }
    const payload: any = {
      warehouse_id: auditData.warehouse_id,
      status: auditData.status === "PLANNED" ? "SCHEDULED" : (auditData.status || "SCHEDULED"),
      notes: noteParts.length > 0 ? noteParts.join(" · ") : null,
    };
    if (auditData.created_by) {
      payload.created_by = auditData.created_by;
    }

    const { data, error } = await db
      .from("inventory_audits")
      .insert([payload])
      .select()
      .single();

    if (error) throw new Error(`Failed to create audit: ${error.message}`);
    if (!data) throw new Error("Failed to create audit: no row was persisted.");

    // Snapshot the warehouse's current stock as the audit's expected
    // quantities, so the perform page has countable items. (Previously
    // nothing ever created audit items, so even a persisted audit would
    // have opened empty.)
    try {
      const { data: levels } = await db
        .from("inventory_levels")
        .select("variant_id, quantity_available")
        .eq("warehouse_id", auditData.warehouse_id);
      const items = (levels || []).map((l: any) => ({
        audit_id: data.id,
        variant_id: l.variant_id,
        expected_quantity: Number(l.quantity_available || 0),
        // Explicitly uncounted: actual stays NULL until a count is entered,
        // so a genuine count of 0 is distinguishable from "not counted".
        actual_quantity: null,
      }));
      if (items.length > 0) {
        await this.createAuditItems(items);
      }
    } catch (e: any) {
      console.warn(`Could not snapshot audit items for audit ${data.id}:`, e?.message);
    }

    const [withWh] = await this.attachAuditWarehouses([data]);
    return withWh;
  }

  async updateAuditStatus(id: string, status: string): Promise<void> {
    const db = this.getAdminClient();
    const dbStatus = status === "PLANNED" ? "SCHEDULED" : status;
    // S4-7: inventory_audits has no `updated_at` column — including it
    // made the DB layer silently discard the whole status update.
    const updates: any = {
      status: dbStatus,
    };

    const { error } = await db
      .from("inventory_audits")
      .update(updates)
      .eq("id", id);

    if (error) throw new Error(`Failed to update audit status: ${error.message}`);
  }

  async getAuditItems(auditId: string): Promise<any[]> {
    const db = this.getAdminClient();
    const { data, error } = await db
      .from("inventory_audit_items")
      .select("*")
      .eq("audit_id", auditId);

    if (error) throw new Error(`Failed to get audit items: ${error.message}`);
    const items = data || [];
    if (items.length === 0) return items;

    // The DB layer does not attach embedded variant/product relations;
    // resolve them manually. Also expose the counted quantity + derived
    // status under the key names the perform form renders
    // (`counted_quantity`, `status`) — the real columns are
    // `actual_quantity` and there is no status column.
    const variantIds: string[] = [...new Set(items.map((i: any) => i.variant_id).filter(Boolean))] as string[];
    const variants = await prisma.variant.findMany({
      where: { id: { in: variantIds } },
      select: {
        id: true,
        sku: true,
        product: { select: { name: true } },
      },
    });
    const byId = new Map<string, any>(variants.map((v: any) => [v.id, v] as [string, any]));
    return items.map((i: any) => {
      const v = byId.get(i.variant_id);
      const counted = i.actual_quantity;
      const status =
        counted === null || counted === undefined
          ? "PENDING"
          : Number(i.variance || 0) === 0
            ? "COUNTED"
            : "DISCREPANCY";
      return {
        ...i,
        counted_quantity: counted ?? null,
        status,
        variant: v ? { sku: v.sku, product: { name: v.product?.name || "Product" } } : null,
      };
    });
  }

  async createAuditItems(items: any[]): Promise<void> {
    if (items.length === 0) return;
    const db = this.getAdminClient();
    // Real columns only: audit_id, variant_id, expected_quantity,
    // actual_quantity, variance. Translate the legacy `counted_quantity`
    // key if a caller still sends it.
    const rows = items.map((i: any) => {
      const row: any = {
        audit_id: i.audit_id,
        variant_id: i.variant_id,
        expected_quantity: Number(i.expected_quantity || 0),
      };
      if ("actual_quantity" in i) {
        // Preserve an explicit null: it marks the item as not yet counted
        // (a genuine count of 0 must stay distinguishable from uncounted).
        row.actual_quantity = i.actual_quantity === null ? null : Number(i.actual_quantity);
      } else if (i.counted_quantity !== undefined && i.counted_quantity !== null) {
        row.actual_quantity = Number(i.counted_quantity);
      }
      if (i.variance !== undefined && i.variance !== null) row.variance = Number(i.variance);
      return row;
    });
    const { error } = await db
      .from("inventory_audit_items")
      .insert(rows);

    if (error) throw new Error(`Failed to create audit items: ${error.message}`);
  }

  async updateAuditItemCount(itemId: string, countedQuantity: number): Promise<void> {
    const db = this.getAdminClient();

    // First fetch the item to get expected quantity
    const { data: item, error: fetchError } = await db
      .from("inventory_audit_items")
      .select("expected_quantity")
      .eq("id", itemId)
      .single();

    if (fetchError) throw new Error(`Failed to get audit item: ${fetchError.message}`);

    const expected = item.expected_quantity;
    const variance = countedQuantity - expected;

    // S4-7: the counted value lives in `actual_quantity`; there is no
    // `counted_quantity` or `status` column — sending them silently
    // discarded the whole update.
    const { error } = await db
      .from("inventory_audit_items")
      .update({
        actual_quantity: countedQuantity,
        variance,
      })
      .eq("id", itemId);

    if (error) throw new Error(`Failed to update audit item count: ${error.message}`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ENTERPRISE STOCK WORKFLOWS (STOCK IN, STOCK OUT, ADJUSTMENT, DETAILED AUDIT)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Enterprise Stock In workflow
   */
  async stockIn(payload: {
    variant_id: string;
    warehouse_id: string;
    bin_id?: string;
    quantity: number;
    unit_cost?: number;
    supplier_id?: string;
    purchase_order_id?: string;
    batch_number?: string;
    serial_number?: string;
    manufacturing_date?: string;
    expiry_date?: string;
    notes?: string;
    userId?: string;
  }): Promise<InventoryLevel> {
    const db = this.getAdminClient();
    const qty = Number(payload.quantity);
    if (!qty || qty <= 0) {
      throw new Error("Received quantity must be greater than zero.");
    }

    // Check if warehouse is active
    const { data: wh, error: whErr } = await db
      .from("warehouses")
      .select("id, is_active, name")
      .eq("id", payload.warehouse_id)
      .single();
    if (whErr || !wh) throw new Error("Destination warehouse not found.");
    if (!wh.is_active) throw new Error(`Warehouse "${wh.name}" is inactive and cannot receive stock.`);

    // Check existing inventory level
    let query = db
      .from("inventory_levels")
      .select("*")
      .eq("variant_id", payload.variant_id)
      .eq("warehouse_id", payload.warehouse_id);

    if (payload.bin_id) {
      query = query.eq("bin_id", payload.bin_id);
    } else {
      query = query.is("bin_id", null);
    }

    const { data: existingLevels, error: fetchErr } = await query.limit(1);
    if (fetchErr) throw new Error(`Database error looking up inventory: ${fetchErr.message}`);

    let updatedLevel: InventoryLevel;

    if (existingLevels && existingLevels.length > 0) {
      const current = existingLevels[0];
      const newAvail = (current.quantity_available || 0) + qty;
      const { data: updated, error: updateErr } = await db
        .from("inventory_levels")
        .update({
          quantity_available: newAvail,
          updated_at: new Date().toISOString(),
        })
        .eq("id", current.id)
        .select()
        .single();
      if (updateErr) throw new Error(`Failed to increment inventory: ${updateErr.message}`);
      updatedLevel = updated as InventoryLevel;
    } else {
      const { data: created, error: insertErr } = await db
        .from("inventory_levels")
        .insert({
          variant_id: payload.variant_id,
          warehouse_id: payload.warehouse_id,
          bin_id: payload.bin_id || null,
          quantity_available: qty,
          quantity_reserved: 0,
          quantity_incoming: 0,
          quantity_damaged: 0,
          quantity_returned: 0,
          reorder_point: 5,
          safety_stock: 2,
        })
        .select()
        .single();
      if (insertErr) throw new Error(`Failed to create inventory record: ${insertErr.message}`);
      updatedLevel = created as InventoryLevel;
    }

    // Record immutable movement
    const movementNotes = [
      payload.notes,
      payload.batch_number ? `Batch: ${payload.batch_number}` : null,
      payload.serial_number ? `Serial: ${payload.serial_number}` : null,
      payload.purchase_order_id ? `PO: ${payload.purchase_order_id}` : null,
    ]
      .filter(Boolean)
      .join(" | ");

    await this.recordMovement({
      variant_id: payload.variant_id,
      warehouse_id: payload.warehouse_id,
      movement_type: "RECEIVE",
      quantity: qty,
      previous_quantity: existingLevels && existingLevels.length > 0 ? Number(existingLevels[0].quantity_available || 0) : 0,
      new_quantity: Number((updatedLevel as any).quantity_available ?? qty),
      to_bin_id: payload.bin_id || null,
      reference_id: payload.purchase_order_id || null,
      reference_type: payload.purchase_order_id ? "PURCHASE_ORDER" : null,
      reason_code: "PURCHASE_RECEIPT",
      notes: movementNotes || `Stock In of ${qty} units`,
      user_id: payload.userId || null,
    });

    return updatedLevel;
  }

  /**
   * Enterprise Stock Out workflow
   */
  async stockOut(payload: {
    variant_id: string;
    warehouse_id: string;
    bin_id?: string;
    quantity: number;
    reason: string;
    notes?: string;
    reference_id?: string;
    userId?: string;
  }): Promise<InventoryLevel> {
    const db = this.getAdminClient();
    const qty = Number(payload.quantity);
    if (!qty || qty <= 0) {
      throw new Error("Stock Out quantity must be greater than zero.");
    }

    // Check warehouse and its negative stock policy
    const { data: wh, error: whErr } = await db
      .from("warehouses")
      .select("id, is_active, name, address")
      .eq("id", payload.warehouse_id)
      .single();
    if (whErr || !wh) throw new Error("Warehouse not found.");
    if (!wh.is_active) throw new Error(`Warehouse "${wh.name}" is deactivated.`);

    let allowNegative = false;
    try {
      if (wh.address && typeof wh.address === "string" && wh.address.startsWith("{")) {
        const parsed = JSON.parse(wh.address);
        allowNegative = !!parsed.allow_negative_stock;
      }
    } catch {
      allowNegative = false;
    }

    // Find inventory level
    let query = db
      .from("inventory_levels")
      .select("*")
      .eq("variant_id", payload.variant_id)
      .eq("warehouse_id", payload.warehouse_id);

    if (payload.bin_id) {
      query = query.eq("bin_id", payload.bin_id);
    } else {
      query = query.is("bin_id", null);
    }

    const { data: levels, error: fetchErr } = await query.limit(1);
    if (fetchErr) throw new Error(`Inventory lookup error: ${fetchErr.message}`);

    const current = levels && levels.length > 0 ? levels[0] : null;
    const currentAvail = current ? Number(current.quantity_available) || 0 : 0;

    if (!allowNegative && currentAvail < qty) {
      throw new Error(
        `Insufficient stock in warehouse "${wh.name}". Available: ${currentAvail}, Requested: ${qty}. Negative stock is not enabled for this warehouse.`
      );
    }

    let updatedLevel: InventoryLevel;
    const newAvail = currentAvail - qty;

    if (current) {
      const { data: updated, error: updateErr } = await db
        .from("inventory_levels")
        .update({
          quantity_available: newAvail,
          updated_at: new Date().toISOString(),
        })
        .eq("id", current.id)
        .select()
        .single();
      if (updateErr) throw new Error(`Failed to decrement inventory: ${updateErr.message}`);
      updatedLevel = updated as InventoryLevel;
    } else {
      const { data: created, error: insertErr } = await db
        .from("inventory_levels")
        .insert({
          variant_id: payload.variant_id,
          warehouse_id: payload.warehouse_id,
          bin_id: payload.bin_id || null,
          quantity_available: newAvail,
          quantity_reserved: 0,
          quantity_incoming: 0,
          quantity_damaged: payload.reason === "DAMAGED" ? qty : 0,
          quantity_returned: 0,
        })
        .select()
        .single();
      if (insertErr) throw new Error(`Failed to create inventory level: ${insertErr.message}`);
      updatedLevel = created as InventoryLevel;
    }

    // Record immutable movement
    await this.recordMovement({
      variant_id: payload.variant_id,
      warehouse_id: payload.warehouse_id,
      movement_type: "SHIP",
      quantity: -qty,
      previous_quantity: currentAvail,
      new_quantity: newAvail,
      from_bin_id: payload.bin_id || null,
      reference_id: payload.reference_id || null,
      reason_code: payload.reason || "STOCK_OUT",
      notes: payload.notes || `Stock Out: ${payload.reason || "Removal"}`,
      user_id: payload.userId || null,
    });

    return updatedLevel;
  }

  /**
   * Enterprise Stock Adjustment with mandatory reason and variance calculation
   */
  async stockAdjustment(payload: {
    variant_id: string;
    warehouse_id: string;
    bin_id?: string;
    physical_count: number;
    reason: string;
    notes?: string;
    userId?: string;
  }): Promise<{ updated: InventoryLevel; variance: number }> {
    const db = this.getAdminClient();
    if (!payload.reason?.trim()) {
      throw new Error("Reason is required for all manual stock adjustments.");
    }
    const physical = Math.max(0, Number(payload.physical_count));

    let query = db
      .from("inventory_levels")
      .select("*")
      .eq("variant_id", payload.variant_id)
      .eq("warehouse_id", payload.warehouse_id);

    if (payload.bin_id) {
      query = query.eq("bin_id", payload.bin_id);
    } else {
      query = query.is("bin_id", null);
    }

    const { data: levels, error: fetchErr } = await query.limit(1);
    if (fetchErr) throw new Error(`Database error: ${fetchErr.message}`);

    const current = levels && levels.length > 0 ? levels[0] : null;
    const systemQty = current ? Number(current.quantity_available) || 0 : 0;
    const variance = physical - systemQty;

    let updatedLevel: InventoryLevel;

    if (current) {
      const { data: updated, error: updateErr } = await db
        .from("inventory_levels")
        .update({
          quantity_available: physical,
          updated_at: new Date().toISOString(),
        })
        .eq("id", current.id)
        .select()
        .single();
      if (updateErr) throw new Error(`Failed to update adjusted inventory: ${updateErr.message}`);
      updatedLevel = updated as InventoryLevel;
    } else {
      const { data: created, error: insertErr } = await db
        .from("inventory_levels")
        .insert({
          variant_id: payload.variant_id,
          warehouse_id: payload.warehouse_id,
          bin_id: payload.bin_id || null,
          quantity_available: physical,
          quantity_reserved: 0,
          quantity_incoming: 0,
          quantity_damaged: 0,
          quantity_returned: 0,
        })
        .select()
        .single();
      if (insertErr) throw new Error(`Failed to create inventory record: ${insertErr.message}`);
      updatedLevel = created as InventoryLevel;
    }

    // Record movement audit
    await this.recordMovement({
      variant_id: payload.variant_id,
      warehouse_id: payload.warehouse_id,
      movement_type: "ADJUST",
      quantity: variance,
      previous_quantity: systemQty,
      new_quantity: physical,
      from_bin_id: payload.bin_id || null,
      reason_code: payload.reason,
      notes: `Physical Count Adjustment: System was ${systemQty}, counted ${physical} (Variance: ${variance > 0 ? "+" : ""}${variance}). Notes: ${payload.notes || ""}`,
      user_id: payload.userId || null,
    });

    return { updated: updatedLevel, variance };
  }

  /**
   * Get rich stock movement history with joined details
   */
  async getDetailedMovements(options?: {
    page?: number;
    limit?: number;
    warehouseId?: string;
    variantId?: string;
    type?: string;
    search?: string;
  }): Promise<{
    data: any[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const db = this.getAdminClient();
    const page = Math.max(1, options?.page || 1);
    const limit = Math.max(1, options?.limit || 50);
    const start = (page - 1) * limit;

    let query = db
      .from("stock_movements")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(start, start + limit - 1);

    if (options?.warehouseId) {
      query = query.eq("warehouse_id", options.warehouseId);
    }
    if (options?.variantId) {
      query = query.eq("variant_id", options.variantId);
    }
    if (options?.type && options.type !== "all") {
      query = query.ilike("movement_type", `%${options.type}%`);
    }

    const { data, count, error } = await query;
    if (error) throw new Error(`Failed to fetch stock movements: ${error.message}`);

    const rows = data || [];

    // S4-9: stock_movements' real columns are movement_type, quantity,
    // previous_quantity, new_quantity, reference_type, reference_id,
    // notes, created_by. The previous implementation read a phantom
    // schema (quantity_change / reason / reason_code / user_id) and
    // embedded relations the DB layer never attaches — so every row
    // rendered as Quantity 0, type "Movement", product "Product",
    // warehouse "Warehouse", user "System". Resolve the real relations
    // manually in batch instead.
    const variantIds: string[] = [...new Set(rows.map((m: any) => m.variant_id).filter(Boolean))] as string[];
    const warehouseIds = [
      ...new Set(
        rows
          .flatMap((m: any) => [m.warehouse_id, m.reference_type === "TRANSFER" ? m.reference_id : null])
          .filter(Boolean)
      ),
    ];
    const userIds = [...new Set(rows.map((m: any) => m.created_by).filter(Boolean))];

    const [variantRows, warehouseRows, profileRows] = await Promise.all([
      variantIds.length
        ? prisma.variant.findMany({
            where: { id: { in: variantIds } },
            select: { id: true, sku: true, product: { select: { name: true } } },
          })
        : Promise.resolve([]),
      warehouseIds.length
        ? db.from("warehouses").select("id, name, code").in("id", warehouseIds).then((r: any) => r.data || [])
        : Promise.resolve([]),
      userIds.length
        ? db.from("profiles").select("id, first_name, last_name, email").in("id", userIds).then((r: any) => r.data || [])
        : Promise.resolve([]),
    ]);
    const variantById = new Map<string, any>((variantRows as any[]).map((v: any) => [v.id, v] as [string, any]));
    const warehouseById = new Map<string, any>((warehouseRows as any[]).map((w: any) => [w.id, w] as [string, any]));
    const profileById = new Map<string, any>((profileRows as any[]).map((p: any) => [p.id, p] as [string, any]));

    const movements = rows.map((m: any) => {
      const t = String(m.movement_type || "").toUpperCase();
      let friendlyType = "Movement";
      if (t.includes("DAMAGE")) {
        friendlyType = "Damage";
      } else if (t.includes("RETURN")) {
        friendlyType = "Return";
      } else if (t.includes("TRANSFER")) {
        friendlyType = "Transfer";
      } else if (t.includes("ADJUST") || t.includes("PHYSICAL")) {
        friendlyType = "Adjustment";
      } else if (t.includes("RECEIVE") || t.includes("PURCHASE") || t === "IN") {
        friendlyType = "Stock In";
      } else if (t.includes("SHIP") || t.includes("SALES") || t.includes("ORDER") || t === "OUT") {
        friendlyType = "Stock Out";
      }

      const variant = variantById.get(m.variant_id);
      const warehouse = warehouseById.get(m.warehouse_id);
      const toWarehouse =
        m.reference_type === "TRANSFER" && t === "TRANSFER_OUT"
          ? warehouseById.get(m.reference_id)
          : undefined;
      const profile = m.created_by ? profileById.get(m.created_by) : undefined;
      const userDisplay = profile
        ? [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.email || "System"
        : "System";

      return {
        id: m.id,
        created_at: m.created_at,
        product_name: variant?.product?.name || "Product",
        sku: variant?.sku || "—",
        warehouse_name: warehouse?.name || "Warehouse",
        warehouse_code: warehouse?.code || "",
        to_warehouse_name: toWarehouse?.name,
        // stock_movements has no bin/zone columns — shown as unassigned.
        zone_name: "—",
        bin_code: "—",
        movement_type: friendlyType,
        raw_type: m.movement_type || "MOVEMENT",
        quantity: Number(m.quantity) || 0,
        previous_quantity: m.previous_quantity,
        new_quantity: m.new_quantity,
        reference_id: m.reference_id || "—",
        user_id: userDisplay,
        notes: m.notes || "",
      };
    });

    const total = count || movements.length;
    return {
      data: movements,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }
}

