/**
 * Pure delivery-zone helpers shared by server services and client
 * components (no database imports — safe to bundle in the browser).
 */

export interface PublicZone {
  id: string;
  name: string;
  code: string | null;
  rate: number;
  districts: string[];
  is_default: boolean;
  sort_order: number;
}

export function normalizePlace(value?: string | null): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Pick the first zone (in the order given) whose districts contain the
 * district/city; otherwise the default zone; otherwise the first zone.
 */
export function pickZone(
  zones: PublicZone[],
  district?: string | null,
  city?: string | null
): PublicZone | null {
  if (!zones.length) return null;
  const targets = [normalizePlace(district), normalizePlace(city)].filter(
    Boolean
  );
  for (const zone of zones) {
    if (zone.is_default) continue;
    const covered = (zone.districts || []).map(normalizePlace);
    if (targets.some((t) => covered.includes(t))) return zone;
  }
  return zones.find((z) => z.is_default) || zones[0];
}

/** The zone that serves Dhaka addresses (used for the "inside" method). */
export function dhakaZone(zones: PublicZone[]): PublicZone | null {
  return pickZone(zones, "Dhaka", "Dhaka");
}

/** The fallback zone for addresses no district list matches. */
export function defaultZone(zones: PublicZone[]): PublicZone | null {
  if (!zones.length) return null;
  return zones.find((z) => z.is_default) || zones[zones.length - 1];
}

/**
 * The delivery fee for a cart, as one pure computation: free at/above the
 * store's free-shipping threshold, otherwise the fee of the zone serving
 * the address (the default zone for the "outside" delivery method), with
 * the legacy flat rates as fallback until zones are known. The checkout
 * summary seeds zones + threshold from the server so the FIRST paint is
 * already correct; this function is the single rule both the seeded and
 * the refreshed states are computed with.
 */
export function computeShippingFee(args: {
  subtotal: number;
  zones: PublicZone[];
  freeThreshold: number;
  shippingMethod?: string | null;
  city?: string | null;
}): number {
  const { subtotal, zones, freeThreshold, shippingMethod, city } = args;
  if (subtotal <= 0) return 0;
  if (freeThreshold > 0 && subtotal >= freeThreshold) return 0;
  if (zones.length > 0) {
    const zone =
      shippingMethod === "home_delivery_outside"
        ? defaultZone(zones)
        : pickZone(zones, city, city);
    if (zone) return zone.rate;
  }
  return shippingMethod === "home_delivery_outside" ? 150 : 100;
}
