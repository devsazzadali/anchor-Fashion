import { createAdminDbClient } from "@/lib/db/client";
import { prisma } from "@/lib/prisma";
import {
  Shipment,
  ShipmentItem,
  ShipmentTrackingEvent,
  ShipmentLabel,
  ShipmentWithDetails,
  ShipmentFilters,
  PaginatedResult,
  ShippingEventType,
} from "@/types/shipping.types";

/**
 * Map a Prisma Shipment row (camelCase, Decimal/Date objects) to the
 * snake_case plain shape the shipping UI renders. Shared by
 * listShipments + getShipmentWithDetails so the queue and the detail
 * can never disagree about the same shipment again.
 */
function mapShipmentRow(s: any): Record<string, any> {
  return {
    id: s.id,
    order_id: s.orderId,
    order_number: s.order?.orderNumber ?? s.order_number ?? null,
    shipment_number: s.shipmentNumber,
    tracking_number: s.trackingNumber,
    courier: s.courier,
    courier_provider_code: s.courierProviderCode,
    status: s.status,
    recipient_name: s.recipientName,
    recipient_phone: s.recipientPhone,
    recipient_address: s.recipientAddress,
    recipient_city: s.recipientCity,
    recipient_district: s.recipientDistrict,
    is_cod: s.isCod ?? false,
    cod_amount: s.codAmount != null ? Number(s.codAmount) : 0,
    shipping_charge: s.shippingCharge != null ? Number(s.shippingCharge) : 0,
    shipping_cost: s.shippingCost != null ? Number(s.shippingCost) : 0,
    weight_kg: s.weightKg != null ? Number(s.weightKg) : null,
    delivery_zone_id: s.deliveryZoneId,
    special_instructions: s.specialInstructions,
    estimated_delivery: s.estimatedDelivery?.toISOString() ?? null,
    shipped_at: s.shippedAt?.toISOString() ?? null,
    delivered_at: s.deliveredAt?.toISOString() ?? null,
    created_at: s.createdAt?.toISOString() ?? null,
    updated_at: s.updatedAt?.toISOString() ?? null,
    created_by: s.createdBy,
  };
}

export class ShipmentRepository {
  private getAdminClient() {
    return createAdminDbClient();
  }

  /**
   * Create a shipment with its items in sequence.
   */
  async createShipment(
    data: Omit<
      Partial<Shipment>,
      "id" | "shipment_number" | "created_at" | "updated_at"
    >,
    items: Omit<Partial<ShipmentItem>, "id" | "shipment_id" | "created_at">[]
  ): Promise<Shipment> {
    const db = this.getAdminClient();

    const payload: any = { ...data };
    if (payload.courier_provider_code && !payload.courier) {
      payload.courier = payload.courier_provider_code;
    } else if (payload.courier && !payload.courier_provider_code) {
      payload.courier_provider_code = payload.courier;
    }
    if (payload.shipping_charge !== undefined && payload.shipping_cost === undefined) {
      payload.shipping_cost = payload.shipping_charge;
    } else if (payload.shipping_cost !== undefined && payload.shipping_charge === undefined) {
      payload.shipping_charge = payload.shipping_cost;
    }

    const { data: shipment, error } = await db
      .from("shipments")
      .insert(payload)
      .select()
      .single();

    if (error) throw new Error(`Create shipment failed: ${error.message}`);

    if (items.length > 0) {
      const { error: itemError } = await db
        .from("shipment_items")
        .insert(
          items.map((item) => ({ ...item, shipment_id: shipment.id })) as any
        );

      if (itemError)
        console.error("Failed to insert shipment items:", itemError);
    }

    return shipment as Shipment;
  }

  /**
   * Update shipment fields.
   */
  async updateShipment(
    id: string,
    data: Partial<Shipment> & { [key: string]: any }
  ): Promise<Shipment> {
    const db = this.getAdminClient();

    const payload: any = { ...data };
    if (payload.courier_provider_code && !payload.courier) {
      payload.courier = payload.courier_provider_code;
    } else if (payload.courier && !payload.courier_provider_code) {
      payload.courier_provider_code = payload.courier;
    }
    if (payload.shipping_charge !== undefined && payload.shipping_cost === undefined) {
      payload.shipping_cost = payload.shipping_charge;
    } else if (payload.shipping_cost !== undefined && payload.shipping_charge === undefined) {
      payload.shipping_charge = payload.shipping_cost;
    }

    const { data: updated, error } = await db
      .from("shipments")
      .update(payload)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(`Update shipment failed: ${error.message}`);
    return updated as Shipment;
  }

  /**
   * Get shipment by ID.
   */
  async getShipmentById(id: string): Promise<Shipment | null> {
    const db = this.getAdminClient();

    const { data, error } = await db
      .from("shipments")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error?.code === "PGRST116") return null;
    if (error) throw new Error(`Get shipment failed: ${error.message}`);
    return data as Shipment | null;
  }

  /**
   * Get shipment by tracking number.
   */
  async getShipmentByTrackingNumber(
    trackingNumber: string
  ): Promise<Shipment | null> {
    const db = this.getAdminClient();

    const { data, error } = await db
      .from("shipments")
      .select("*")
      .eq("tracking_number", trackingNumber)
      .maybeSingle();

    if (error?.code === "PGRST116") return null;
    if (error)
      throw new Error(`Get shipment by tracking failed: ${error.message}`);
    return data as Shipment | null;
  }

  /**
   * Get all shipments for an order.
   */
  async getShipmentsByOrderId(orderId: string): Promise<Shipment[]> {
    const db = this.getAdminClient();

    const { data, error } = await db
      .from("shipments")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: false });

    if (error)
      throw new Error(`Get shipments by order failed: ${error.message}`);
    return (data ?? []) as Shipment[];
  }

  /**
   * Get full shipment details with related data.
   *
   * REG-17: this used a PostgREST-style embed select (items / events /
   * courier / zone / order joins). The row builder never resolves
   * embeds, so every joined field came back missing — the detail page
   * showed no order number and no items for a shipment that exists.
   * Composed on Prisma instead: the shipment row plus its items,
   * labels, tracking events, audit events and the order's number,
   * mapped to the snake_case shape the page renders.
   */
  async getShipmentWithDetails(
    id: string
  ): Promise<ShipmentWithDetails | null> {
    const row = await prisma.shipment.findUnique({
      where: { id },
      include: {
        order: { select: { orderNumber: true } },
        items: true,
        labels: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!row) return null;

    const [trackingEvents, events] = await Promise.all([
      prisma.shipment_tracking_events
        .findMany({
          where: { shipment_id: id },
          orderBy: { timestamp: "desc" },
        })
        .catch(() => [] as any[]),
      prisma.shipment_events
        .findMany({
          where: { shipment_id: id },
          orderBy: { created_at: "desc" },
        })
        .catch(() => [] as any[]),
    ]);

    return {
      ...mapShipmentRow(row),
      items: (row.items ?? []).map((it: any) => ({
        id: it.id,
        shipment_id: it.shipmentId,
        order_item_id: it.orderItemId,
        quantity: it.quantity,
        created_at: it.createdAt?.toISOString() ?? null,
      })),
      labels: (row.labels ?? []).map((l: any) => ({
        id: l.id,
        shipment_id: l.shipmentId,
        label_url: l.labelUrl,
        tracking_number: l.trackingNumber,
        courier: l.courier,
        print_count: l.printCount,
        created_at: l.createdAt?.toISOString() ?? null,
      })),
      tracking_events: trackingEvents.map((e: any) => ({
        id: e.id,
        shipment_id: e.shipment_id,
        status: e.status,
        event_time: e.timestamp?.toISOString() ?? null,
        location: e.location,
        notes: e.notes,
      })),
      events: events.map((e: any) => ({
        id: e.id,
        shipment_id: e.shipment_id,
        status: e.status,
        location: e.location,
        notes: e.notes,
        created_at: e.created_at?.toISOString() ?? null,
      })),
      order_number: row.order?.orderNumber ?? null,
    } as unknown as ShipmentWithDetails;
  }

  /**
   * List shipments with filters and pagination.
   *
   * REG-17: this read from `v_shipments_summary` — a relation that
   * does not exist in the database (verified against
   * information_schema: no such view or table). The fluent DB layer
   * silently resolves unknown relations to an empty result, so the
   * Shipment Queue permanently showed "No shipments found" while the
   * analytics counter — which counts the real `shipments` table —
   * said Total 1. Now read from the same real table the counter
   * counts, via Prisma, with the order's number joined in.
   */
  async listShipments(
    filters: ShipmentFilters
  ): Promise<PaginatedResult<Shipment>> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;

    const where: Record<string, any> = {};
    if (filters.status) where.status = filters.status;
    if (filters.courierCode) where.courierProviderCode = filters.courierCode;
    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {
        ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
        ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {}),
      };
    }
    if (filters.search) {
      const q = filters.search;
      where.OR = [
        { shipmentNumber: { contains: q, mode: "insensitive" } },
        { trackingNumber: { contains: q, mode: "insensitive" } },
        { recipientName: { contains: q, mode: "insensitive" } },
      ];
    }

    const [total, rows] = await Promise.all([
      prisma.shipment.count({ where }),
      prisma.shipment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: { order: { select: { orderNumber: true } } },
      }),
    ]);

    return {
      data: rows.map(mapShipmentRow) as unknown as Shipment[],
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ============================================================================
  // TRACKING EVENTS
  // ============================================================================

  async addTrackingEvent(
    shipmentId: string,
    event: Omit<ShipmentTrackingEvent, "id" | "shipment_id" | "created_at">
  ): Promise<void> {
    const db = this.getAdminClient();
    await db
      .from("shipment_tracking_events")
      .insert({ ...event, shipment_id: shipmentId } as any);
  }

  async upsertTrackingEvent(
    shipmentId: string,
    event: Omit<ShipmentTrackingEvent, "id" | "shipment_id" | "created_at">
  ): Promise<void> {
    const db = this.getAdminClient();
    // Upsert by (shipment_id, event_time, status) to prevent duplicates
    const { error } = await db
      .from("shipment_tracking_events")
      .upsert({ ...event, shipment_id: shipmentId } as any, {
        onConflict: "shipment_id,event_time,status",
        ignoreDuplicates: true,
      });
    if (error) console.error("Upsert tracking event:", error);
  }

  async getTrackingEvents(
    shipmentId: string
  ): Promise<ShipmentTrackingEvent[]> {
    const db = this.getAdminClient();
    const { data, error } = await db
      .from("shipment_tracking_events")
      .select("*")
      .eq("shipment_id", shipmentId)
      .order("event_time", { ascending: false });

    if (error) throw new Error(`Get tracking events failed: ${error.message}`);
    return (data ?? []) as ShipmentTrackingEvent[];
  }

  // ============================================================================
  // LABELS
  // ============================================================================

  async saveLabel(
    shipmentId: string,
    label: Omit<
      ShipmentLabel,
      | "id"
      | "shipment_id"
      | "generated_at"
      | "printed_at"
      | "print_count"
      | "created_at"
    >
  ): Promise<ShipmentLabel> {
    const db = this.getAdminClient();
    const { data, error } = await db
      .from("shipment_labels")
      .insert({ ...label, shipment_id: shipmentId } as any)
      .select()
      .single();

    if (error) throw new Error(`Save label failed: ${error.message}`);
    return data as ShipmentLabel;
  }

  async getLabels(shipmentId: string): Promise<ShipmentLabel[]> {
    const db = this.getAdminClient();
    const { data, error } = await db
      .from("shipment_labels")
      .select("*")
      .eq("shipment_id", shipmentId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(`Get labels failed: ${error.message}`);
    return (data ?? []) as ShipmentLabel[];
  }

  async incrementLabelPrintCount(labelId: string): Promise<void> {
    const db = this.getAdminClient();
    await db
      .from("shipment_labels")
      .update({ printed_at: new Date().toISOString() } as any)
      .eq("id", labelId);

    // Increment via raw SQL for atomicity
    await db
      .rpc("increment_label_print_count", { label_id: labelId })
      .maybeSingle();
  }

  // ============================================================================
  // EVENTS
  // ============================================================================

  async addEvent(
    shipmentId: string,
    eventType: ShippingEventType,
    payload: Record<string, any> = {},
    triggeredBy?: string,
    source: "system" | "admin" | "webhook" | "customer" = "system"
  ): Promise<void> {
    const db = this.getAdminClient();
    await db.from("shipment_events").insert({
      shipment_id: shipmentId,
      event_type: eventType,
      payload,
      triggered_by: triggeredBy ?? null,
      source,
    } as any);
  }
}
