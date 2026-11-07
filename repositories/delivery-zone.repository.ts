// ============================================================================
// Delivery Zone Repository
// ============================================================================

import { createAdminDbClient } from "@/lib/db/client";
import { DeliveryZone, ShippingRate } from "@/types/shipping.types";

/**
 * The real `delivery_zones` table columns are only:
 *   id, name, code, rate (Decimal), districts (String[]), is_default,
 *   is_active, sort_order, created_at, updated_at.
 *
 * Callers (ZoneForm / delivery-zone actions) also trade in display-only
 * legacy keys — description, estimated_days_min, estimated_days_max,
 * is_cod_available — which are NOT columns. Passing any unknown key into a
 * `db.from("delivery_zones")` write makes the builder silently drop the
 * whole write (empty success), so create/update payloads are sanitized to
 * the real columns below before they reach the builder.
 */
const DELIVERY_ZONE_REAL_COLUMNS = [
  "name",
  "code",
  "rate",
  "districts",
  "is_active",
  "is_default",
  "sort_order",
] as const;

function sanitizeZonePayload(data: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};
  for (const column of DELIVERY_ZONE_REAL_COLUMNS) {
    if (data[column] !== undefined) {
      sanitized[column] = data[column];
    }
  }
  // `rate` is a Decimal column; persist it as a plain number.
  if (sanitized.rate !== undefined && sanitized.rate !== null) {
    sanitized.rate = Number(sanitized.rate);
  }
  return sanitized;
}

/**
 * Normalize a raw zone row for callers: guarantee `rate` is present as a
 * plain number (the builder may hand back a Decimal / numeric string).
 */
function withRate(zone: any): any {
  if (!zone) return zone;
  return { ...zone, rate: Number(zone.rate ?? 0) };
}

export class DeliveryZoneRepository {
  private getClient() {
    return createAdminDbClient();
  }

  /**
   * Get zone by code.
   */
  async getZoneByCode(code: string): Promise<DeliveryZone | null> {
    const db = this.getClient();

    const { data, error } = await db
      .from("delivery_zones")
      .select("*")
      .eq("code", code)
      .eq("is_active", true)
      .maybeSingle();

    if (error) throw new Error(`Get zone by code failed: ${error.message}`);
    return data as DeliveryZone | null;
  }

  /**
   * Get zone by ID.
   */
  async getZoneById(id: string): Promise<DeliveryZone | null> {
    const db = this.getClient();

    const { data, error } = await db
      .from("delivery_zones")
      // Explicit column list (real columns only) so `rate` is always
      // included in what callers such as ZoneForm's initialData receive.
      .select("id, name, code, rate, districts, is_default, is_active, sort_order, created_at, updated_at")
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(`Get zone by ID failed: ${error.message}`);
    return withRate(data as Record<string, any> | null) as DeliveryZone | null;
  }

  /**
   * Find zone by district or city match.
   */
  async getZoneByAddress(
    district: string,
    city?: string
  ): Promise<DeliveryZone | null> {
    const db = this.getClient();

    // Try to match district in the districts array
    const { data, error } = await db
      .from("delivery_zones")
      .select("*")
      .eq("is_active", true)
      .contains("districts", [district]);

    if (error) throw new Error(`Zone lookup failed: ${error.message}`);

    if (data && data.length > 0) return data[0] as DeliveryZone;

    // Fallback: try city match in any array element
    if (city) {
      const { data: cityMatch } = await db
        .from("delivery_zones")
        .select("*")
        .eq("is_active", true)
        .contains("districts", [city]);

      if (cityMatch && cityMatch.length > 0)
        return cityMatch[0] as DeliveryZone;
    }

    // Fallback to REMOTE zone
    return this.getZoneByCode("REMOTE");
  }

  /**
   * Get all active zones.
   */
  async getAllActiveZones(): Promise<DeliveryZone[]> {
    const db = this.getClient();

    const { data, error } = await db
      .from("delivery_zones")
      .select("*")
      .eq("is_active", true)
      .order("name");

    if (error) throw new Error(`Get active zones failed: ${error.message}`);
    return (data ?? []) as DeliveryZone[];
  }

  /**
   * Get all zones (including inactive).
   */
  async getAllZones(): Promise<DeliveryZone[]> {
    const db = this.getClient();

    const { data, error } = await db
      .from("delivery_zones")
      // Explicit column list (real columns only), including `rate`.
      .select("id, name, code, rate, districts, is_default, is_active, sort_order, created_at, updated_at")
      .order("name");

    if (error) throw new Error(`Get all zones failed: ${error.message}`);
    return ((data ?? []) as Record<string, any>[]).map((zone) =>
      withRate(zone)
    ) as DeliveryZone[];
  }

  /**
   * Create a new delivery zone.
   */
  async createZone(
    data: Omit<DeliveryZone, "id" | "created_at" | "updated_at">
  ): Promise<DeliveryZone> {
    const db = this.getClient();

    const { data: zone, error } = await db
      .from("delivery_zones")
      .insert(sanitizeZonePayload(data as Record<string, any>) as any)
      .select()
      .single();

    if (error) throw new Error(`Create zone failed: ${error.message}`);
    return withRate(zone as Record<string, any>) as DeliveryZone;
  }

  /**
   * Update a delivery zone.
   */
  async updateZone(
    id: string,
    data: Partial<DeliveryZone>
  ): Promise<DeliveryZone> {
    const db = this.getClient();

    const { data: zone, error } = await db
      .from("delivery_zones")
      .update(sanitizeZonePayload(data as Record<string, any>) as any)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(`Update zone failed: ${error.message}`);
    return withRate(zone as Record<string, any>) as DeliveryZone;
  }

  // ============================================================================
  // SHIPPING RATES
  // ============================================================================

  /**
   * Get shipping rates for a zone.
   */
  async getShippingRates(zoneId: string): Promise<ShippingRate[]> {
    const db = this.getClient();

    const { data, error } = await db
      .from("shipping_rates")
      .select("*")
      .eq("zone_id", zoneId)
      .eq("is_active", true);

    if (error) throw new Error(`Get rates failed: ${error.message}`);
    return (data ?? []) as ShippingRate[];
  }

  /**
   * Upsert a shipping rate.
   */
  async upsertRate(
    data: Omit<ShippingRate, "id" | "created_at" | "updated_at">
  ): Promise<ShippingRate> {
    const db = this.getClient();

    const { data: rate, error } = await db
      .from("shipping_rates")
      .upsert(data as any, { onConflict: "zone_id,name,is_cod_rate" })
      .select()
      .single();

    if (error) throw new Error(`Upsert rate failed: ${error.message}`);
    return rate as ShippingRate;
  }

  /**
   * Calculate charge via Postgres stored procedure.
   */
  async calculateCharge(
    zoneId: string,
    weightKg: number,
    orderValue: number,
    isCOD: boolean
  ): Promise<number> {
    const db = this.getClient();

    const { data, error } = await db.rpc("calculate_shipping_charge", {
      p_zone_id: zoneId,
      p_weight_kg: weightKg,
      p_order_value: orderValue,
      p_is_cod: isCOD,
    });

    if (error) {
      console.error("calculateCharge RPC failed:", error);
      return 0;
    }

    return Number(data ?? 0);
  }
}
