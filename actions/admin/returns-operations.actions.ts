"use server";

import { createAdminDbClient } from "@/lib/db/client";
import { revalidatePath } from "next/cache";
import { verifyStaff } from "@/lib/security/roles";

export interface ReturnItemInput {
  orderItemId?: string;
  variantId?: string;
  sku?: string;
  productName?: string;
  quantity: number;
  reason?: string;
  condition?: "good" | "damaged" | "defective";
  refundAmount?: number;
}

export interface CreateReturnPayload {
  orderId?: string;
  customerId?: string;
  customerName?: string;
  reason: string;
  notes?: string;
  refundAmount?: number;
  items: ReturnItemInput[];
}

export async function getOperationsReturnsAction(filters: {
  status?: string;
  search?: string;
} = {}) {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    const db = createAdminDbClient();

    // REG-83: plain select + explicit relation attach. The embedded
    // `items:return_items(*)` / `customer:customers(...)` selects are not
    // attached by the DB layer (silently dropped), so the operations
    // returns list rendered without items or customer. Items and
    // customers are now fetched with batched plain queries and attached.
    let query = db
      .from("returns")
      .select("*")
      .order("created_at", { ascending: false });

    if (filters.status && filters.status !== "ALL") {
      query = query.eq("status", filters.status.toUpperCase());
    }

    if (filters.search) {
      query = query.ilike("return_number", `%${filters.search}%`);
    }

    const { data: returns, error } = await query;
    if (error) return { success: false, error: error.message };

    const rows: any[] = returns || [];
    if (rows.length > 0) {
      const returnIds = rows.map((r: any) => r.id).filter(Boolean);
      const customerIds = [...new Set(rows.map((r: any) => r.customer_id).filter(Boolean))];
      const [{ data: itemRows }, { data: customerRows }] = await Promise.all([
        returnIds.length
          ? db.from("return_items").select("*").in("return_id", returnIds)
          : Promise.resolve({ data: [] as any[] }),
        customerIds.length
          ? db.from("customers").select("id, name, email, phone").in("id", customerIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      const itemsByReturn = new Map<string, any[]>();
      for (const item of itemRows || []) {
        if (!itemsByReturn.has(item.return_id)) itemsByReturn.set(item.return_id, []);
        itemsByReturn.get(item.return_id)!.push(item);
      }
      const customerById = new Map<string, any>(
        (customerRows || []).map((c: any) => [c.id, c] as [string, any])
      );
      for (const row of rows) {
        row.items = itemsByReturn.get(row.id) || [];
        row.customer = row.customer_id ? customerById.get(row.customer_id) ?? null : null;
      }
    }

    return { success: true, data: rows };
  } catch (err: any) {
    console.error("[getOperationsReturnsAction]", err);
    return { success: false, error: err.message || "Failed to fetch returns" };
  }
}

export async function createOperationsReturnAction(payload: CreateReturnPayload) {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    const db = createAdminDbClient();

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const rand = Math.floor(1000 + Math.random() * 9000);
    const returnNumber = `RET-${dateStr}-${rand}`;

    const { data: ret, error: returnError } = await db
      .from("returns")
      .insert({
        return_number: returnNumber,
        order_id: payload.orderId || null,
        customer_id: payload.customerId || null,
        status: "REQUESTED",
        reason: payload.reason,
        notes: payload.notes || null,
        refund_amount: payload.refundAmount || 0,
      })
      .select()
      .single();

    if (returnError) throw returnError;

    if (payload.items && payload.items.length > 0) {
      const itemsToInsert = payload.items.map((item) => ({
        return_id: ret.id,
        order_item_id: item.orderItemId || null,
        variant_id: item.variantId || null,
        quantity: item.quantity || 1,
        reason: item.reason || payload.reason,
        condition: item.condition || "good",
        restocked: false,
      }));

      const { error: itemsError } = await db
        .from("return_items")
        .insert(itemsToInsert);

      if (itemsError) {
        console.warn("[createOperationsReturnAction] Warning: Could not insert items", itemsError);
      }
    }

    revalidatePath("/admin/operations/returns/requests");
    revalidatePath("/admin/orders/returns");
    revalidatePath("/admin/shipping/returns");

    return { success: true, data: ret };
  } catch (err: any) {
    console.error("[createOperationsReturnAction]", err);
    return { success: false, error: err.message || "Failed to create return" };
  }
}

export async function updateOperationsReturnStatusAction(
  returnId: string,
  newStatus: "REQUESTED" | "APPROVED" | "REJECTED" | "RECEIVED" | "REFUNDED" | "COMPLETED",
  notes?: string
) {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    const db = createAdminDbClient();

    const updateData: Record<string, any> = {
      status: newStatus,
      updated_at: new Date().toISOString(),
    };

    if (notes) {
      updateData.notes = notes;
    }

    const { data: updatedRow, error } = await db
      .from("returns")
      .update(updateData)
      .eq("id", returnId)
      .select("*")
      .single();

    if (error) throw error;

    // REG-83: the items MUST be fetched explicitly — the old code read
    // them from an embedded `items:return_items(*)` select on the update
    // result, which the DB layer never attaches, so `updated.items` was
    // always undefined and the RECEIVED restock below never ran:
    // returned "good" items silently vanished from sellable stock.
    const { data: returnItems } = await db
      .from("return_items")
      .select("*")
      .eq("return_id", returnId);
    const updated: any = { ...updatedRow, items: returnItems || [] };

    // If status is marked as RECEIVED and items exist, restock "good" condition items
    if (newStatus === "RECEIVED" && updated.items?.length) {
      for (const item of updated.items) {
        if (!item.restocked && item.condition === "good" && item.variant_id) {
          // Find first active warehouse or default warehouse
          const { data: wh } = await db
            .from("warehouses")
            .select("id")
            .eq("is_active", true)
            .limit(1)
            .maybeSingle();

          if (wh?.id) {
            const { data: currentLevel } = await db
              .from("inventory_levels")
              .select("id, quantity_available")
              .eq("variant_id", item.variant_id)
              .eq("warehouse_id", wh.id)
              .maybeSingle();

            const prevQty = currentLevel?.quantity_available || 0;
            const newQty = prevQty + (item.quantity || 1);

            if (currentLevel?.id) {
              await db
                .from("inventory_levels")
                .update({ quantity_available: newQty })
                .eq("id", currentLevel.id);
            } else {
              await db
                .from("inventory_levels")
                .insert({
                  variant_id: item.variant_id,
                  warehouse_id: wh.id,
                  quantity_available: newQty,
                  quantity_reserved: 0,
                  reorder_point: 5,
                });
            }

            // Record stock movement
            try {
              await db.from("stock_movements").insert({
                variant_id: item.variant_id,
                warehouse_id: wh.id,
                quantity_change: item.quantity || 1,
                reason: `Restocked from return #${updated.return_number}`,
                reason_code: "RETURN",
                reference_id: updated.return_number,
              });
            } catch (e: any) {
              console.warn("Could not insert stock_movements log:", e?.message);
            }

            // Mark item as restocked
            await db
              .from("return_items")
              .update({ restocked: true })
              .eq("id", item.id);
          }
        }
      }
    }

    revalidatePath("/admin/operations/returns/requests");
    revalidatePath("/admin/orders/returns");
    revalidatePath("/admin/shipping/returns");

    return { success: true, data: updated };
  } catch (err: any) {
    console.error("[updateOperationsReturnStatusAction]", err);
    return { success: false, error: err.message || "Failed to update return status" };
  }
}

export async function getOrdersForReturnAction(search: string = "") {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    const db = createAdminDbClient();

    let query = db
      .from("orders")
      .select("id, order_number, total_amount, status, customer_id, profiles(first_name, last_name, email)")
      .order("created_at", { ascending: false })
      .limit(10);

    if (search) {
      query = query.ilike("order_number", `%${search}%`);
    }

    const { data: orders, error } = await query;
    if (error) {
      // Fallback
      const { data: fbOrders } = await db
        .from("orders")
        .select("id, order_number, total_amount, status, customer_id")
        .order("created_at", { ascending: false })
        .limit(10);
      return { success: true, data: fbOrders || [] };
    }

    return { success: true, data: orders || [] };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to fetch orders" };
  }
}
