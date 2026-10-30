"use server";

import { createAdminDbClient } from "@/lib/db/client";
import { revalidatePath } from "next/cache";
import { verifyStaff } from "@/lib/security/roles";

function mapSupplierRow(s: any) {
  return {
    id: s.id,
    name: s.name,
    company_name: s.name,
    contact_person: s.contact_name || "",
    email: s.email || "",
    phone: s.phone || "",
    performance_score: 5.0,
    status: s.is_active === false ? "INACTIVE" : "ACTIVE",
  };
}

async function generateUniqueSupplierCode(
  db: ReturnType<typeof createAdminDbClient>,
  companyName: string
): Promise<string> {
  const base =
    companyName
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/g, "") || "SUPPLIER";

  let candidate = base;
  let suffix = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data: existing } = await db
      .from("suppliers")
      .select("id")
      .eq("code", candidate)
      .maybeSingle();
    if (!existing) return candidate;
    const suffixStr = `-${suffix}`;
    candidate = `${base.slice(0, 40 - suffixStr.length).replace(/-+$/g, "")}${suffixStr}`;
    suffix += 1;
  }
}

export async function getSupplierProfiles() {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  const db = createAdminDbClient();
  const { data, error } = await db
    .from("suppliers")
    .select("id, name, contact_name, email, phone, is_active")
    .order("name", { ascending: true });

  if (error) return { success: false, error: error.message };
  return {
    success: true,
    data: (data || []).map((s: any) => mapSupplierRow(s)),
  };
}

export async function createSupplierProfileAction(data: {
  company_name: string;
  contact_person?: string;
  email?: string;
  phone?: string;
  performance_score?: number;
  status?: string;
}) {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    const db = createAdminDbClient();
    const cleanCompany = data.company_name.trim();
    const cleanStatus = (data.status || "ACTIVE").toUpperCase();
    const cleanEmail = data.email?.trim() ? data.email.trim().toLowerCase() : null;

    // Check duplicate email beforehand to provide helpful message
    if (cleanEmail) {
      const { data: existingSupplier } = await db
        .from("suppliers")
        .select("name, email")
        .ilike("email", cleanEmail)
        .maybeSingle();

      if (existingSupplier) {
        return {
          success: false,
          error: `A supplier with email "${cleanEmail}" already exists (${existingSupplier.name}). Please use a different email address.`,
        };
      }
    }

    const code = await generateUniqueSupplierCode(db, cleanCompany);

    const { data: supplier, error } = await db
      .from("suppliers")
      .insert({
        name: cleanCompany,
        code,
        contact_name: data.contact_person?.trim() || null,
        email: cleanEmail,
        phone: data.phone?.trim() || null,
        is_active: cleanStatus === "ACTIVE",
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505" || error.message?.includes("unique")) {
        return {
          success: false,
          error: `A supplier with this email already exists. Each supplier must have a unique email address.`,
        };
      }
      return { success: false, error: error.message };
    }

    try {
      revalidatePath("/admin/inventory/suppliers");
      revalidatePath("/admin/inventory/stock");
      revalidatePath("/admin/inventory/purchases");
    } catch {}

    return { success: true, data: mapSupplierRow(supplier) };
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to create supplier profile" };
  }
}

export async function updateSupplierProfileAction(
  id: string,
  data: Partial<{
    company_name: string;
    contact_person: string;
    email: string;
    phone: string;
    performance_score: number;
    status: string;
  }>
) {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    const db = createAdminDbClient();
    const cleanEmail =
      data.email !== undefined
        ? data.email?.trim()
          ? data.email.trim().toLowerCase()
          : null
        : undefined;

    // Check duplicate email across other suppliers
    if (cleanEmail) {
      const { data: existingSupplier } = await db
        .from("suppliers")
        .select("id, name, email")
        .ilike("email", cleanEmail)
        .neq("id", id)
        .maybeSingle();

      if (existingSupplier) {
        return {
          success: false,
          error: `Another supplier (${existingSupplier.name}) is already using the email "${cleanEmail}". Please use a different email address.`,
        };
      }
    }

    const updatePayload: Record<string, any> = {};
    if (data.company_name !== undefined) {
      updatePayload.name = data.company_name.trim();
    }
    if (data.contact_person !== undefined) {
      updatePayload.contact_name = data.contact_person?.trim() || null;
    }
    if (cleanEmail !== undefined) {
      updatePayload.email = cleanEmail;
    }
    if (data.phone !== undefined) {
      updatePayload.phone = data.phone?.trim() || null;
    }
    if (data.status !== undefined) {
      updatePayload.is_active = data.status.toUpperCase() === "ACTIVE";
    }

    const { data: updated, error } = await db
      .from("suppliers")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      if (error.code === "23505" || error.message?.includes("unique")) {
        return {
          success: false,
          error: `A supplier with this email already exists. Each supplier must have a unique email address.`,
        };
      }
      return { success: false, error: error.message };
    }

    try {
      revalidatePath("/admin/inventory/suppliers");
    } catch {}

    return { success: true, data: mapSupplierRow(updated) };
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to update supplier profile" };
  }
}

export async function deleteSupplierProfileAction(id: string) {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    const db = createAdminDbClient();
    const { error } = await db
      .from("suppliers")
      .delete()
      .eq("id", id);

    if (error) return { success: false, error: error.message };

    try {
      revalidatePath("/admin/inventory/suppliers");
    } catch {}

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to delete supplier profile" };
  }
}

export async function getWarehouses() {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  const db = createAdminDbClient();
  const { data, error } = await db
    .from("warehouses")
    .select("id, name, warehouse_code, is_active")
    .order("name", { ascending: true });
    
  if (error) return { success: false, error: error.message };
  return {
    success: true,
    data: (data || [])
      .filter((w: any) => w.is_active !== false)
      .map((w: any) => ({
        id: w.id,
        name: w.name,
        code: w.warehouse_code || "",
        warehouse_code: w.warehouse_code || "",
        is_active: w.is_active,
      })),
  };
}

export async function getVariants() {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  const db = createAdminDbClient();
  const { data, error } = await db
    .from("variants")
    .select("id, sku, price_override, sale_price, attributes, product:products(id, name, base_price, cost_price)")
    .limit(300);
    
  if (error) return { success: false, error: error.message };

  return {
    success: true,
    data: (data || []).map((v: any) => {
      const pName = v.product?.name || "Product";
      const attrStr = v.attributes ? Object.values(v.attributes).filter(Boolean).join(" / ") : "";
      const label = attrStr ? `${pName} (${v.sku} - ${attrStr})` : `${pName} (${v.sku})`;
      const price = Number(v.sale_price || v.price_override || v.product?.base_price || 0);
      const costPrice = Number(v.product?.cost_price || (price ? price * 0.6 : 0));
      return {
        id: v.id,
        sku: v.sku,
        name: label,
        title: label,
        product_name: pName,
        price,
        cost_price: costPrice,
      };
    }),
  };
}

export async function createProcurementOrder(
  poData: {
    po_number?: string;
    supplier_id: string;
    destination_warehouse_id: string;
    expected_delivery_date?: string;
    tax_rate?: number;
    notes?: string;
  },
  items: Array<{
    variant_id: string;
    quantity_ordered: number;
    unit_cost: number;
  }>
) {
  // SECURITY: server actions are public endpoints; authorize every call.
  const user = await verifyStaff();
  try {
    const db = createAdminDbClient();

    const validItems = (items || []).filter(
      (i) => i.variant_id && Number(i.quantity_ordered) > 0 && Number(i.unit_cost) >= 0
    );

    if (validItems.length === 0) {
      return { success: false, error: "At least one item with a valid quantity and cost is required." };
    }

    // 1. Authoritative server-side calculation of line item totals
    const processedItems = validItems.map((item) => {
      const qty = Math.max(1, Math.floor(Number(item.quantity_ordered) || 1));
      const cost = Math.max(0, Number(item.unit_cost) || 0);
      const lineTotal = Number((qty * cost).toFixed(2));
      return {
        variant_id: item.variant_id,
        quantity_ordered: qty,
        unit_cost: cost,
        total_cost: lineTotal,
      };
    });

    // 2. Authoritative server-side calculation of subtotal, tax, and grand total
    const subtotal = processedItems.reduce((acc, item) => acc + item.total_cost, 0);
    const taxRate = typeof poData.tax_rate === "number" && poData.tax_rate >= 0 ? poData.tax_rate : 0.05;
    const taxAmount = Number((subtotal * taxRate).toFixed(2));
    const grandTotal = Number((subtotal + taxAmount).toFixed(2));

    const poNumber = poData.po_number || `PO-${Date.now().toString().slice(-6)}`;

    // 3. Insert the order with authoritative grand total.
    // S4-6: the real tables are `purchase_orders` / `purchase_order_items`
    // (columns: warehouse_id, expected_date / purchase_order_id,
    // quantity). This action previously inserted into a nonexistent
    // `procurement_orders` table — the DB layer answered with an empty
    // success, `po` came back null, and reading `po.id` threw
    // "Cannot read properties of null (reading 'id')" on every submit.
    const createdBy =
      (user as any)?.id &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test((user as any).id)
        ? (user as any).id
        : null;
    const { data: po, error: poError } = await db
      .from("purchase_orders")
      .insert({
        po_number: poNumber,
        supplier_id: poData.supplier_id,
        warehouse_id: poData.destination_warehouse_id,
        expected_date: poData.expected_delivery_date || null,
        total_amount: grandTotal,
        notes: poData.notes || `Subtotal: BDT ${subtotal.toFixed(2)}, Tax (${(taxRate * 100).toFixed(0)}%): BDT ${taxAmount.toFixed(2)}, Grand Total: BDT ${grandTotal.toFixed(2)}`,
        status: "DRAFT",
        created_by: createdBy,
      })
      .select()
      .single();

    if (poError) return { success: false, error: poError.message };
    if (!po) return { success: false, error: "Failed to create purchase order: no row was persisted." };

    // 4. Insert Items with line totals
    const itemsToInsert = processedItems.map((item) => ({
      purchase_order_id: po.id,
      variant_id: item.variant_id,
      quantity: item.quantity_ordered,
      unit_cost: item.unit_cost,
      total_cost: item.total_cost,
    }));

    const { error: itemsError } = await db
      .from("purchase_order_items")
      .insert(itemsToInsert);

    if (itemsError) {
      // Roll back the order so a failed item insert never orphans a PO.
      await db.from("purchase_orders").delete().eq("id", po.id);
      return { success: false, error: itemsError.message || "Failed to create purchase order items." };
    }

    revalidatePath("/admin/inventory/purchases");
    revalidatePath("/admin/operations/procurement/purchase-orders");
    return {
      success: true,
      data: {
        id: po.id,
        po_number: poNumber,
        subtotal,
        taxAmount,
        grandTotal,
      },
    };
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to create procurement order" };
  }
}

export async function getProcurementOrderDetails(poId: string) {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    const db = createAdminDbClient();
    // S4-6: read the real `purchase_orders` family (see
    // createProcurementOrder). Relations are resolved manually — the DB
    // layer does not attach embedded selects — and mapped into the
    // shape the purchases client renders (supplier_profiles /
    // warehouses / expected_delivery_date / quantity_ordered / variants).
    const { data: po, error: poErr } = await db
      .from("purchase_orders")
      .select("*")
      .eq("id", poId)
      .single();

    if (poErr) return { success: false, error: poErr.message };
    if (!po) return { success: false, error: "Purchase order not found" };

    const [{ data: supplier }, { data: warehouse }, { data: items }] = await Promise.all([
      db.from("suppliers").select("*").eq("id", po.supplier_id).maybeSingle(),
      db.from("warehouses").select("*").eq("id", po.warehouse_id).maybeSingle(),
      db.from("purchase_order_items").select("*").eq("purchase_order_id", poId),
    ]);

    const itemRows = items || [];
    const variantIds = [...new Set(itemRows.map((i: any) => i.variant_id).filter(Boolean))];
    let variantById = new Map<string, any>();
    if (variantIds.length > 0) {
      const { data: variants } = await db
        .from("variants")
        .select("id, sku, attributes, product_id")
        .in("id", variantIds);
      const productIds = [...new Set((variants || []).map((v: any) => v.product_id).filter(Boolean))];
      const { data: products } = productIds.length
        ? await db.from("products").select("id, name").in("id", productIds)
        : { data: [] as any[] };
      const productById = new Map<string, any>((products || []).map((p: any) => [p.id, p] as [string, any]));
      variantById = new Map<string, any>(
        (variants || []).map((v: any) => {
          const pName = productById.get(v.product_id)?.name || "Product";
          const attrStr = v.attributes ? Object.values(v.attributes).filter(Boolean).join(" / ") : "";
          const label = attrStr ? `${pName} (${v.sku} - ${attrStr})` : `${pName} (${v.sku})`;
          return [v.id, { id: v.id, sku: v.sku, name: label }] as [string, any];
        })
      );
    }

    return {
      success: true,
      data: {
        ...po,
        expected_delivery_date: po.expected_date || null,
        supplier_profiles: supplier
          ? {
              company_name: supplier.name,
              contact_person: supplier.contact_name || "",
              email: supplier.email || "",
              phone: supplier.phone || "",
            }
          : null,
        warehouses: warehouse ? { name: warehouse.name, code: warehouse.code || "" } : null,
        items: itemRows.map((i: any) => ({
          ...i,
          quantity_ordered: i.quantity,
          variants: variantById.get(i.variant_id) || null,
        })),
      },
    };
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to fetch PO details" };
  }
}

export async function updateProcurementOrderStatus(
  poId: string,
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "SENT" | "PARTIAL_RECEIPT" | "DELIVERED" | "CANCELLED"
) {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    const db = createAdminDbClient();
    const { error } = await db
      .from("purchase_orders")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", poId);

    if (error) return { success: false, error: error.message };

    revalidatePath("/admin/inventory/purchases");
    revalidatePath("/admin/operations/procurement/purchase-orders");
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to update PO status" };
  }
}

export async function receiveProcurementOrderAction(poId: string, notes?: string) {
  // SECURITY: server actions are public endpoints; authorize every call.
  const user = await verifyStaff();
  try {
    const db = createAdminDbClient();

    // 1. Fetch PO and items (S4-6: real `purchase_orders` family; the
    // embedded-items select is not resolved by the DB layer, so items
    // are fetched with their own query.)
    const { data: po, error: poErr } = await db
      .from("purchase_orders")
      .select("*")
      .eq("id", poId)
      .single();

    if (poErr || !po) {
      return { success: false, error: "Purchase order not found" };
    }

    if (po.status === "DELIVERED" || po.status === "FULFILLED") {
      return { success: false, error: "This purchase order has already been received." };
    }

    const destinationWarehouseId = po.warehouse_id;
    if (!destinationWarehouseId) {
      return { success: false, error: "No destination warehouse assigned to this PO." };
    }

    const { data: itemRows } = await db
      .from("purchase_order_items")
      .select("*")
      .eq("purchase_order_id", poId);
    const items = itemRows || [];
    if (items.length === 0) {
      return { success: false, error: "Purchase order has no items to receive." };
    }

    const createdBy =
      (user as any)?.id &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test((user as any).id)
        ? (user as any).id
        : null;

    // 2. Increment stock in inventory_levels for each item
    for (const item of items) {
      const variantId = item.variant_id;
      const qtyReceived = Number(item.quantity) || 0;
      if (!variantId || qtyReceived <= 0) continue;

      const { data: existingLevel } = await db
        .from("inventory_levels")
        .select("id, quantity_available")
        .eq("variant_id", variantId)
        .eq("warehouse_id", destinationWarehouseId)
        .maybeSingle();

      const previousQty = existingLevel?.quantity_available || 0;
      const newQty = previousQty + qtyReceived;

      if (existingLevel) {
        await db
          .from("inventory_levels")
          .update({
            quantity_available: newQty,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingLevel.id);
      } else {
        await db.from("inventory_levels").insert({
          variant_id: variantId,
          warehouse_id: destinationWarehouseId,
          quantity_available: newQty,
          quantity_reserved: 0,
        });
      }

      // Record stock movement — real stock_movements columns only
      // (movement_type / quantity / previous_quantity / new_quantity /
      // reference_type / reference_id / notes / created_by).
      try {
        await db.from("stock_movements").insert({
          variant_id: variantId,
          warehouse_id: destinationWarehouseId,
          movement_type: "IN",
          quantity: qtyReceived,
          previous_quantity: previousQty,
          new_quantity: newQty,
          reference_type: "PURCHASE_ORDER",
          reference_id: po.id,
          notes: notes || `Goods received from PO: ${po.po_number || poId}`,
          created_by: createdBy,
        });
      } catch (e: any) {
        console.warn("Could not insert stock_movements log:", e?.message);
      }
    }

    // 3. Mark PO as DELIVERED / FULFILLED
    await db
      .from("purchase_orders")
      .update({
        status: "DELIVERED",
        updated_at: new Date().toISOString(),
      })
      .eq("id", poId);

    revalidatePath("/admin/inventory/purchases");
    revalidatePath("/admin/operations/procurement/purchase-orders");
    revalidatePath("/admin/inventory/stock");
    revalidatePath("/admin/inventory/movement");

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to receive goods" };
  }
}

