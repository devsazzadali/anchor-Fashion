import { createAdminDbClient } from "@/lib/db/client";
import { Supplier, PurchaseOrder, PurchaseOrderItem } from "@/types/inventory.types";

export class ProcurementRepository {
  private getAdminClient() {
    return createAdminDbClient();
  }

  // --- Suppliers ---

  async getSuppliers(): Promise<Supplier[]> {
    const db = this.getAdminClient();
    const { data, error } = await db
      .from("suppliers")
      .select("*")
      .order("name", { ascending: true });

    if (error) throw new Error(`Failed to fetch suppliers: ${error.message}`);
    return data as Supplier[];
  }

  async getWarehouses(): Promise<any[]> {
    const db = this.getAdminClient();
    // Warehouses have no `status` column (the flag is `is_active`);
    // filtering on `status` silently poisoned the whole query.
    const { data, error } = await db
      .from("warehouses")
      .select("*")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) throw new Error(`Failed to fetch warehouses: ${error.message}`);
    return data;
  }

  async getSupplierById(id: string): Promise<Supplier | null> {
    const db = this.getAdminClient();
    const { data, error } = await db
      .from("suppliers")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw new Error(`Failed to fetch supplier: ${error.message}`);
    }
    return data as Supplier;
  }

  async createSupplier(supplier: Omit<Supplier, "id" | "created_at" | "updated_at">): Promise<Supplier> {
    const db = this.getAdminClient();
    const { data, error } = await db
      .from("suppliers")
      .insert(supplier)
      .select()
      .single();

    if (error) throw new Error(`Failed to create supplier: ${error.message}`);
    return data as Supplier;
  }

  async updateSupplier(id: string, updates: Partial<Supplier>): Promise<Supplier> {
    const db = this.getAdminClient();
    const { data, error } = await db
      .from("suppliers")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update supplier: ${error.message}`);
    return data as Supplier;
  }

  // --- Purchase Orders ---

  async getPurchaseOrders(): Promise<any[]> {
    const db = this.getAdminClient();
    const { data, error } = await db
      .from("purchase_orders")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw new Error(`Failed to fetch purchase orders: ${error.message}`);
    const rows = data || [];

    // The DB layer does not attach embedded relations; join names manually.
    const supplierIds = [...new Set(rows.map((p: any) => p.supplier_id).filter(Boolean))];
    const warehouseIds = [...new Set(rows.map((p: any) => p.warehouse_id).filter(Boolean))];
    const [suppliersRes, warehousesRes] = await Promise.all([
      supplierIds.length
        ? db.from("suppliers").select("id, name").in("id", supplierIds)
        : Promise.resolve({ data: [] as any[] }),
      warehouseIds.length
        ? db.from("warehouses").select("id, name").in("id", warehouseIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const supplierById = new Map<string, any>((((suppliersRes as any).data || []) as any[]).map((s: any) => [s.id, s] as [string, any]));
    const warehouseById = new Map<string, any>((((warehousesRes as any).data || []) as any[]).map((w: any) => [w.id, w] as [string, any]));

    return rows.map((po: any) => ({
      ...po,
      supplier: supplierById.get(po.supplier_id) || null,
      warehouse: warehouseById.get(po.warehouse_id) || null,
    }));
  }

  async getPurchaseOrderById(id: string): Promise<any | null> {
    const db = this.getAdminClient();
    const { data, error } = await db
      .from("purchase_orders")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw new Error(`Failed to fetch purchase order: ${error.message}`);
    }
    if (!data) return null;

    const [{ data: supplier }, { data: warehouse }, { data: items }] = await Promise.all([
      db.from("suppliers").select("*").eq("id", data.supplier_id).maybeSingle(),
      db.from("warehouses").select("*").eq("id", data.warehouse_id).maybeSingle(),
      db.from("purchase_order_items").select("*").eq("purchase_order_id", id),
    ]);

    return {
      ...data,
      supplier: supplier || null,
      warehouse: warehouse || null,
      items: items || [],
    };
  }

  async createPurchaseOrder(
    poData: Omit<PurchaseOrder, "id" | "created_at" | "updated_at">,
    items: Omit<PurchaseOrderItem, "id" | "po_id" | "created_at" | "updated_at">[]
  ): Promise<PurchaseOrder> {
    const db = this.getAdminClient();

    // S4-6: translate the legacy form shape to purchase_orders' real
    // columns (warehouse_id / expected_date — not
    // destination_warehouse_id / expected_delivery_date). Sending the
    // legacy keys made the DB layer silently discard the whole insert.
    const raw: any = poData as any;
    const orderRow: any = {
      po_number: raw.po_number,
      supplier_id: raw.supplier_id,
      warehouse_id: raw.destination_warehouse_id ?? raw.warehouse_id,
      status: raw.status || "DRAFT",
      total_amount: raw.total_amount ?? 0,
      expected_date: raw.expected_delivery_date ?? raw.expected_date ?? null,
      notes: raw.notes ?? null,
      created_by: raw.ordered_by ?? raw.created_by ?? null,
    };

    // Sequence of inserts since we can't easily write a complex RPC dynamically
    const { data: po, error: poError } = await db
      .from("purchase_orders")
      .insert(orderRow)
      .select()
      .single();

    if (poError) throw new Error(`Failed to create PO: ${poError.message}`);
    if (!po) throw new Error("Failed to create PO: no row was persisted.");

    if (items && items.length > 0) {
      const itemsToInsert = items.map((item: any) => ({
        purchase_order_id: po.id,
        variant_id: item.variant_id,
        quantity: item.quantity_ordered ?? item.quantity ?? 0,
        unit_cost: item.unit_cost ?? 0,
        total_cost:
          item.total_cost ??
          Number(((item.quantity_ordered ?? item.quantity ?? 0) * (item.unit_cost ?? 0)).toFixed(2)),
      }));

      const { error: itemsError } = await db
        .from("purchase_order_items")
        .insert(itemsToInsert);

      if (itemsError) {
        // Rollback PO if items fail
        await db.from("purchase_orders").delete().eq("id", po.id);
        throw new Error(`Failed to create PO items: ${itemsError.message}`);
      }
    }

    return po as PurchaseOrder;
  }

  async updatePurchaseOrderStatus(id: string, status: string): Promise<void> {
    const db = this.getAdminClient();
    const { error } = await db
      .from("purchase_orders")
      .update({ status })
      .eq("id", id);

    if (error) throw new Error(`Failed to update PO status: ${error.message}`);
  }
}
