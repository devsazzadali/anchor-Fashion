"use server";

import { createAdminDbClient } from "@/lib/db/client";
import { revalidatePath } from "next/cache";
import { verifyStaff } from "@/lib/security/roles";

export async function getPickListsAction() {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    const db = createAdminDbClient();
    // FIX ROUND 28 (M-3): pick_lists / pick_list_items real columns are
    // (pick_list_number, warehouse_id, order_id, assigned_picker_id,
    // status, …) and (pick_list_id, variant_id, quantity_required,
    // quantity_picked, status, location). The old select embedded
    // warehouses(...) and items:pick_list_items(id, quantity, is_picked,
    // picked_at) — none of those columns/relations resolve, and the row
    // fields it read (list_number, total_items, picked_items,
    // assigned_to) do not exist, so the list rendered phantom totals.
    // Relations are now fetched with batched plain queries and attached.
    const { data: lists, error } = await db
      .from("pick_lists")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      return { success: false, error: error.message };
    }

    const rows: any[] = lists || [];
    const listIds = rows.map((l: any) => l.id).filter(Boolean);
    const warehouseIds = [...new Set(rows.map((l: any) => l.warehouse_id).filter(Boolean))];
    const pickerIds = [...new Set(rows.map((l: any) => l.assigned_picker_id).filter(Boolean))];

    const [{ data: itemRows }, { data: warehouseRows }, { data: profiles }] =
      await Promise.all([
        listIds.length
          ? db.from("pick_list_items").select("*").in("pick_list_id", listIds)
          : Promise.resolve({ data: [] as any[] }),
        warehouseIds.length
          ? db.from("warehouses").select("id, name, code").in("id", warehouseIds)
          : Promise.resolve({ data: [] as any[] }),
        pickerIds.length
          ? db
              .from("profiles")
              .select("id, first_name, last_name, email")
              .in("id", pickerIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);

    const itemsByList = new Map<string, any[]>();
    for (const item of itemRows || []) {
      if (!itemsByList.has(item.pick_list_id)) itemsByList.set(item.pick_list_id, []);
      itemsByList.get(item.pick_list_id)!.push(item);
    }
    const warehouseById = new Map<string, any>(
      (warehouseRows || []).map((w: any) => [w.id, w] as [string, any])
    );
    const profileMap: Record<string, string> = {};
    (profiles || []).forEach((p: any) => {
      profileMap[p.id] = `${p.first_name || ""} ${p.last_name || ""}`.trim() || p.email;
    });

    const processed = rows.map((list: any) => {
      const items = itemsByList.get(list.id) || [];
      const totalRequired = items.reduce(
        (sum: number, i: any) => sum + (Number(i.quantity_required) || 0),
        0
      );
      const totalPicked = items.reduce(
        (sum: number, i: any) => sum + (Number(i.quantity_picked) || 0),
        0
      );
      const wh = list.warehouse_id ? warehouseById.get(list.warehouse_id) : null;

      return {
        ...list,
        items,
        warehouses: wh ? { id: wh.id, name: wh.name, code: wh.code || "" } : null,
        itemsTotal: totalRequired,
        itemsPicked: totalPicked,
        assignedToName:
          list.assigned_picker_id && profileMap[list.assigned_picker_id]
            ? profileMap[list.assigned_picker_id]
            : "Unassigned",
      };
    });

    return { success: true, data: processed };
  } catch (error) {
    return { success: false, error: (error as Error).message || "Failed to fetch pick lists" };
  }
}

export async function getPickersAction() {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    const db = createAdminDbClient();
    const { data, error } = await db
      .from("profiles")
      .select("id, first_name, last_name, email")
      .eq("is_active", true)
      .limit(50);

    if (error) return { success: false, error: error.message };
    return {
      success: true,
      data: (data || []).map((p: any) => ({
        id: p.id,
        name: `${p.first_name || ""} ${p.last_name || ""}`.trim() || p.email,
        email: p.email,
      })),
    };
  } catch (error) {
    return { success: false, error: (error as Error).message || "Failed to fetch pickers" };
  }
}

export async function generatePickListFromOrdersAction(warehouseId?: string) {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    const db = createAdminDbClient();

    // 1. Find eligible orders using authoritative Postgres order_status enum values
    const query = db
      .from("orders")
      .select("id, order_number, status, order_items(id, variant_id, quantity)")
      .in("status", ["confirmed", "paid", "preparing", "ready_for_shipment", "pending_payment"])
      .limit(10);

    const { data: orders, error: ordersErr } = await query;
    if (ordersErr) throw ordersErr;

    // Determine target warehouse
    let targetWarehouseId = warehouseId;
    if (!targetWarehouseId) {
      const { data: defaultWh } = await db
        .from("warehouses")
        .select("id")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      targetWarehouseId = defaultWh?.id;
    }

    if (!targetWarehouseId) {
      return { success: false, error: "No active warehouse found to generate pick list." };
    }

    // 2. Aggregate order items (real pick_list_items columns:
    // variant_id + quantity_required; pick_list_items has no
    // order_item_id / quantity / is_picked columns).
    const itemsToInsert: { variant_id: string; quantity: number }[] = [];
    const contributingOrderIds = new Set<string>();

    if (orders && orders.length > 0) {
      for (const order of orders) {
        if (order.order_items && order.order_items.length > 0) {
          for (const item of order.order_items) {
            if (!item.variant_id) continue;
            itemsToInsert.push({
              variant_id: item.variant_id,
              quantity: item.quantity || 1,
            });
            contributingOrderIds.add(order.id);
          }
        }
      }
    }

    // FIX ROUND 28 (M-3): the "sample catalog variants" fallback is
    // REMOVED. It existed because the generator's reads/writes were
    // poisoned and it fabricated pick lists of sample products that no
    // customer ordered — a pick list must only ever contain real order
    // items. With no eligible order items the honest result is an
    // error, not a fabricated list.
    if (itemsToInsert.length === 0) {
      return {
        success: false,
        error: "No eligible orders with items are available to generate a pick list.",
      };
    }

    const pickListNumber = `PL-${Date.now().toString().slice(-6)}`;

    // 3. Create the pick list with real columns only (pick_list_number,
    // warehouse_id, order_id, status). The old payload's list_number /
    // pick_type / total_items / picked_items columns do not exist, so
    // the builder discarded the insert whole and .single() yielded no
    // row — production pick_lists stayed at 0 rows.
    const { data: newPickList, error: plErr } = await db
      .from("pick_lists")
      .insert({
        pick_list_number: pickListNumber,
        warehouse_id: targetWarehouseId,
        order_id:
          contributingOrderIds.size === 1
            ? [...contributingOrderIds][0]
            : null,
        status: "PENDING",
      })
      .select()
      .single();

    if (plErr) throw plErr;

    // 4. Create pick list items with real columns.
    const formattedItems = itemsToInsert.map((item) => ({
      pick_list_id: newPickList.id,
      variant_id: item.variant_id,
      quantity_required: item.quantity || 1,
      quantity_picked: 0,
      status: "PENDING",
    }));

    const { error: itemErr } = await db.from("pick_list_items").insert(formattedItems);
    if (itemErr) {
      throw itemErr;
    }

    try {
      revalidatePath("/admin/operations/fulfillment/pick-lists");
      revalidatePath("/admin/inventory/fulfillment");
    } catch {}

    return { success: true, data: newPickList };
  } catch (error) {
    return { success: false, error: (error as Error).message || "Failed to generate pick list" };
  }
}

export async function assignPickerAction(pickListId: string, pickerId: string) {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    const db = createAdminDbClient();
    const { error } = await db
      .from("pick_lists")
      .update({
        // FIX ROUND 28 (M-3): the column is assigned_picker_id —
        // `assigned_to` does not exist and poisoned the update.
        assigned_picker_id: pickerId || null,
        status: "IN_PROGRESS",
      })
      .eq("id", pickListId);

    if (error) throw error;
    try {
      revalidatePath("/admin/operations/fulfillment/pick-lists");
      revalidatePath("/admin/inventory/fulfillment");
    } catch {}
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message || "Failed to assign picker" };
  }
}

export async function updatePickListStatusAction(
  pickListId: string,
  status: "PENDING" | "ASSIGNED" | "PICKING" | "PARTIALLY_PICKED" | "COMPLETED" | "CANCELLED" | "IN_PROGRESS"
) {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    const db = createAdminDbClient();

    // Map UI status variants to DB check constraint ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')
    let dbStatus: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" = "PENDING";
    if (status === "COMPLETED") {
      dbStatus = "COMPLETED";
    } else if (status === "CANCELLED") {
      dbStatus = "CANCELLED";
    } else if (
      status === "IN_PROGRESS" ||
      status === "PICKING" ||
      status === "ASSIGNED" ||
      status === "PARTIALLY_PICKED"
    ) {
      dbStatus = "IN_PROGRESS";
    }

    const updates: any = {
      status: dbStatus,
    };

    if (dbStatus === "COMPLETED") {
      updates.completed_at = new Date().toISOString();
      // FIX ROUND 28 (M-3): pick_list_items has no is_picked/picked_at
      // columns — progress lives in quantity_picked (+ status). Mark
      // every item fully picked with its real columns.
      const { data: items } = await db
        .from("pick_list_items")
        .select("id, quantity_required")
        .eq("pick_list_id", pickListId);
      for (const item of items || []) {
        await db
          .from("pick_list_items")
          .update({
            quantity_picked: item.quantity_required ?? 0,
            status: "PICKED",
          })
          .eq("id", item.id);
      }
    }

    const { error } = await db
      .from("pick_lists")
      .update(updates)
      .eq("id", pickListId);

    if (error) throw error;
    try {
      revalidatePath("/admin/operations/fulfillment/pick-lists");
      revalidatePath("/admin/inventory/fulfillment");
    } catch {}
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message || "Failed to update pick list status" };
  }
}
