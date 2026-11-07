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
    const { data, error } = await db
      .from("warehouses")
      .select("*")
      .eq("status", "active")
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
      .select(`
        *,
        supplier:suppliers(name),
        warehouse:warehouses(name)
      `)
      .order("created_at", { ascending: false });

    if (error) throw new Error(`Failed to fetch purchase orders: ${error.message}`);
    return data;
  }

  async getPurchaseOrderById(id: string): Promise<any | null> {
    const db = this.getAdminClient();
    const { data, error } = await db
      .from("purchase_orders")
      .select(`
        *,
        supplier:suppliers(*),
        warehouse:warehouses(*),
        items:purchase_order_items(
          *,
          variant:variants(
            sku,
            product:products(name)
          )
        )
      `)
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw new Error(`Failed to fetch purchase order: ${error.message}`);
    }
    return data;
  }

  async createPurchaseOrder(
    poData: Omit<PurchaseOrder, "id" | "created_at" | "updated_at">,
    items: Omit<PurchaseOrderItem, "id" | "po_id" | "created_at" | "updated_at">[]
  ): Promise<PurchaseOrder> {
    const db = this.getAdminClient();
    
    // Sequence of inserts since we can't easily write a complex RPC dynamically
    const { data: po, error: poError } = await db
      .from("purchase_orders")
      .insert(poData)
      .select()
      .single();

    if (poError) throw new Error(`Failed to create PO: ${poError.message}`);

    if (items && items.length > 0) {
      const itemsToInsert = items.map((item) => ({
        ...item,
        po_id: po.id,
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
