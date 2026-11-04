import type { Prisma } from "@prisma/client";
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

// ============================================================================
// FIX ROUND 23B — real-column guard for every write in this repository.
//
// The fluent DB builder (lib/db/query.ts) silently discards an ENTIRE
// insert / update / upsert when ANY payload key is not a real column of
// the target table: toCamelData() returns null for the row (insert and
// upsert executors then resolve gracefulEmpty — success, no write) and
// the update executor does the same on `keys.some((k) => !fields[k])`.
// Round 23 cleaned the ShippingService update payloads; this round makes
// the repository itself enforce the invariant for its remaining tables
// (events / tracking events / labels / items), whose payloads are built
// here from caller data. Column sets below mirror prisma/schema.prisma.
// Data whose concept has NO column is dropped at this boundary (listed
// per method) — it must never poison the whole write again.
// ============================================================================

/** Real columns of `shipments` (model Shipment, prisma/schema.prisma). */
const SHIPMENTS_COLUMNS: ReadonlySet<string> = new Set([
  "id",
  "order_id",
  "shipment_number",
  "tracking_number",
  "courier",
  "courier_provider_code",
  "status",
  "recipient_name",
  "recipient_phone",
  "recipient_address",
  "recipient_city",
  "recipient_district",
  "delivery_zone_id",
  "is_cod",
  "cod_amount",
  "shipping_charge",
  "shipping_cost",
  "weight_kg",
  "special_instructions",
  "estimated_delivery",
  "shipped_at",
  "delivered_at",
  "created_by",
  "created_at",
  "updated_at",
]);

/**
 * Normalize an arbitrary caller payload onto the real `shipments`
 * columns: camelCase keys are snake_cased, the one renamed column
 * (`estimated_delivery_date` -> `estimated_delivery`) is translated,
 * and keys with no column (consignment_id, provider_status, label_url,
 * label_generated_at, failure_reason, updated_by, ...) are dropped.
 */
function toShipmentRow(data: Record<string, any>): Record<string, any> {
  const row: Record<string, any> = {};
  for (const [key, value] of Object.entries(data ?? {})) {
    if (value === undefined) continue;
    let col = key.replace(/([A-Z])/g, "_$1").toLowerCase();
    if (col === "estimated_delivery_date") col = "estimated_delivery";
    if (SHIPMENTS_COLUMNS.has(col)) row[col] = value;
  }
  return row;
}

/**
 * Map a caller tracking event onto the real `shipment_tracking_events`
 * columns (shipment_id / status / timestamp / location / notes).
 * Callers pass the ShipmentTrackingEvent shape: `event_time` is the
 * real `timestamp`, `status_description` is the real `notes`.
 * `tracking_number` (already stored on the shipment row) and
 * `provider_raw` (no JSON column exists) have no home and are dropped.
 */
function toTrackingEventRow(
  shipmentId: string,
  event: Omit<ShipmentTrackingEvent, "id" | "shipment_id" | "created_at"> & {
    notes?: string | null;
    timestamp?: string;
  }
): Record<string, any> {
  const row: Record<string, any> = {
    shipment_id: shipmentId,
    status: event.status,
    location: event.location ?? null,
    notes: event.status_description ?? event.notes ?? null,
  };
  const ts = event.event_time ?? event.timestamp;
  if (ts !== undefined && ts !== null) row.timestamp = ts;
  return row;
}

/** Keep the courier code / legacy courier and charge / cost pairs in sync. */
function coupleShipmentRow(payload: Record<string, any>): void {
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
}

/**
 * Map a Prisma Shipment row (camelCase, Decimal/Date objects) to the
 * snake_case plain shape the shipping UI renders. Shared by
 * listShipments + getShipmentWithDetails so the queue and the detail
 * can never disagree about the same shipment again.
 */
/**
 * REG-65 batch 1: the Prisma Shipment row mapShipmentRow consumes —
 * the order-number include both callers fetch, plus the legacy
 * snake_case `order_number` key one fallback path reads.
 */
type ShipmentRowForMapping = Prisma.ShipmentGetPayload<{
  include: { order: { select: { orderNumber: true } } };
}> & { order_number?: string | null };

/** REG-65 batch 1: createShipment item input — the DTO fields plus
 * the camelCase orderItemId callers actually pass. */
type ShipmentItemInput = Omit<
  Partial<ShipmentItem>,
  "id" | "shipment_id" | "created_at"
> & { orderItemId?: string | null };

/** REG-65 batch 1: saveLabel input — the DTO fields plus the
 * tracking_number / courier values callers actually pass. */
type ShipmentLabelInput = Omit<
  ShipmentLabel,
  "id" | "shipment_id" | "generated_at" | "printed_at" | "print_count" | "created_at"
> & { tracking_number?: string | null; courier?: string | null };

function mapShipmentRow(s: ShipmentRowForMapping): Record<string, any> {
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
    items: ShipmentItemInput[]
  ): Promise<Shipment> {
    const db = this.getAdminClient();

    // FIX ROUND 23B: build the insert from real columns only (see the
    // guard note at the top of this file).
    const payload: Record<string, any> = toShipmentRow({ ...data });
    coupleShipmentRow(payload);

    const { data: shipment, error } = await db
      .from("shipments")
      .insert(payload)
      .select()
      .single();

    if (error) throw new Error(`Create shipment failed: ${error.message}`);

    if (items.length > 0) {
      // FIX ROUND 23B: `shipment_items` real columns are only
      // shipment_id / order_item_id / quantity (+ id, created_at).
      // Callers pass CreateShipmentInput items (camelCase orderItemId
      // plus sku / productName / variantName / unitPrice); spreading
      // them verbatim poisoned the insert, so shipment items NEVER
      // persisted. Map the two persistable fields explicitly — sku,
      // product name, variant and unit price have no column and are
      // dropped (they remain on the order's own items).
      const itemRows = items.map((item) => ({
        shipment_id: shipment.id,
        order_item_id: item.order_item_id ?? item.orderItemId ?? null,
        quantity: item.quantity ?? 1,
      }));
      const { error: itemError } = await db
        .from("shipment_items")
        .insert(itemRows);

      if (itemError) {
      }
    }

    return shipment as Shipment;
  }

  /**
   * Update shipment fields.
   */
  async updateShipment(
    id: string,
    data: Partial<Shipment> & { [key: string]: unknown }
  ): Promise<Shipment> {
    const db = this.getAdminClient();

    // FIX ROUND 23B: normalize onto real columns (see the guard note at
    // the top of this file). This also rescues the two caller payloads
    // Round 23 did not cover: TrackingService.refreshTracking's
    // estimated_delivery_date now lands on `estimated_delivery`, and
    // generateLabel's label bookkeeping (label_url / label_generated_at
    // — no columns on shipments; the label itself persists via
    // saveLabel) no longer poisons anything.
    const payload: Record<string, any> = toShipmentRow({ ...data });
    coupleShipmentRow(payload);

    if (Object.keys(payload).length === 0) {
      // Nothing persistable — skip the write entirely (the builder
      // would answer an empty update with a syntax error) and return
      // the current row, preserving the previous benign behaviour.
      return this.getShipmentById(id) as Promise<Shipment>;
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

    // FIX ROUND 23 (REG-83 label leg): resolve the courier DISPLAY name
    // from courier_providers by code, the same way the customer order
    // page does. The detail page previously rendered the raw provider
    // code (or "—"), so a booked shipment never showed its courier name.
    const courierCode =
      row.courierProviderCode ?? row.courier ?? null;
    let courierName: string | null = null;
    if (courierCode) {
      const provider = await prisma.courier_providers
        .findFirst({ where: { code: courierCode }, select: { name: true } })
        .catch(() => null);
      courierName = provider?.name ?? null;
    }

    const [trackingEvents, events] = await Promise.all([
      prisma.shipment_tracking_events
        .findMany({
          where: { shipment_id: id },
          orderBy: { timestamp: "desc" },
        })
        .catch(() => []),
      prisma.shipment_events
        .findMany({
          where: { shipment_id: id },
          orderBy: { created_at: "desc" },
        })
        .catch(() => []),
    ]);

    return {
      ...mapShipmentRow(row),
      courier_name: courierName,
      items: (row.items ?? []).map((it) => ({
        id: it.id,
        shipment_id: it.shipmentId,
        order_item_id: it.orderItemId,
        quantity: it.quantity,
        created_at: it.createdAt?.toISOString() ?? null,
      })),
      labels: (row.labels ?? []).map((l) => ({
        id: l.id,
        shipment_id: l.shipmentId,
        label_url: l.labelUrl,
        tracking_number: l.trackingNumber,
        courier: l.courier,
        print_count: l.printCount,
        created_at: l.createdAt?.toISOString() ?? null,
      })),
      tracking_events: trackingEvents.map((e) => ({
        id: e.id,
        shipment_id: e.shipment_id,
        status: e.status,
        event_time: e.timestamp?.toISOString() ?? null,
        location: e.location,
        notes: e.notes,
      })),
      events: events.map((e) => ({
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
    // FIX ROUND 23B: persist the mapped real-column row (see
    // toTrackingEventRow). Spreading the caller's ShipmentTrackingEvent
    // shape verbatim (tracking_number / status_description / event_time
    // / provider_raw) made the builder discard every tracking event.
    await db
      .from("shipment_tracking_events")
      .insert(toTrackingEventRow(shipmentId, event));
  }

  async upsertTrackingEvent(
    shipmentId: string,
    event: Omit<ShipmentTrackingEvent, "id" | "shipment_id" | "created_at">
  ): Promise<void> {
    const db = this.getAdminClient();
    // Upsert by (shipment_id, timestamp, status) to prevent duplicates.
    // FIX ROUND 23B: the conflict key previously named `event_time`,
    // which is not a column — the builder discarded the whole upsert
    // before the payload was even examined.
    const { error } = await db
      .from("shipment_tracking_events")
      .upsert(toTrackingEventRow(shipmentId, event), {
        onConflict: "shipment_id,timestamp,status",
        ignoreDuplicates: true,
      });
    if (error) {}
  }

  async getTrackingEvents(
    shipmentId: string
  ): Promise<ShipmentTrackingEvent[]> {
    const db = this.getAdminClient();
    const { data, error } = await db
      .from("shipment_tracking_events")
      .select("*")
      .eq("shipment_id", shipmentId)
      .order("timestamp", { ascending: false });

    if (error) throw new Error(`Get tracking events failed: ${error.message}`);
    return (data ?? []) as ShipmentTrackingEvent[];
  }

  // ============================================================================
  // LABELS
  // ============================================================================

  async saveLabel(
    shipmentId: string,
    label: ShipmentLabelInput
  ): Promise<ShipmentLabel> {
    const db = this.getAdminClient();
    // FIX ROUND 23B: `shipment_labels` real columns are shipment_id /
    // label_url / tracking_number / courier (+ id, created_at,
    // print_count). Callers pass label_type / label_data, which have no
    // column — spreading them in discarded the whole insert, so no
    // label was ever saved. Persist the real fields only.
    const row: Record<string, any> = {
      shipment_id: shipmentId,
      label_url: label.label_url ?? null,
      tracking_number: label.tracking_number ?? null,
      courier: label.courier ?? null,
    };
    const { data, error } = await db
      .from("shipment_labels")
      .insert(row)
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
    // FIX ROUND 23B: the previous `.update({ printed_at })` named a
    // column `shipment_labels` does not have, so the builder discarded
    // it (harmlessly, but it never recorded anything). There is no
    // printed-at column — the print COUNT below is the only record.
    // Increment via raw SQL for atomicity (lib/db/rpc.ts implements
    // increment_label_print_count as print_count = print_count + 1).
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
    // FIX ROUND 23B: `shipment_events` real columns are shipment_id /
    // status / location / notes (+ id, created_at). This method used to
    // insert event_type / payload / triggered_by / source as if they
    // were columns — none exist, so the builder discarded EVERY audit
    // event and the production table stayed completely empty. Mapping:
    // the event type goes to `status`; a string payload.location goes
    // to `location`; the full payload plus provenance (source, who
    // triggered it) is preserved verbatim as JSON in `notes`, which is
    // exactly what getShipmentWithDetails surfaces to the detail page.
    const detail: Record<string, any> = { ...(payload ?? {}) };
    const location =
      typeof detail.location === "string" ? detail.location : null;
    const notesData: Record<string, any> = { ...detail };
    if (triggeredBy) notesData.triggered_by = triggeredBy;
    if (source) notesData.source = source;
    await db.from("shipment_events").insert({
      shipment_id: shipmentId,
      status: eventType,
      location,
      notes:
        Object.keys(notesData).length > 0 ? JSON.stringify(notesData) : null,
    });
  }
}
