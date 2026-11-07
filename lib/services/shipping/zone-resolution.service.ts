/**
 * Delivery-zone resolution (Workstream C — admin-configurable zones).
 *
 * Single source of truth for "which zone serves this address, and what does
 * it cost". Zones live in the `delivery_zones` table and are managed from
 * Admin → Settings → Store (Shipping Zones & Rates):
 *   - each zone has a name, a flat charge (`rate`), a list of districts it
 *     covers, an active flag and a sort order;
 *   - exactly one zone is the DEFAULT zone: it serves every address no
 *     other active zone matches (its own district list is ignored).
 *
 * Matching: the customer's district (falling back to city) is compared,
 * case-insensitively, against each active zone's districts in sort order.
 *
 * Legacy fallback: if the table is somehow empty, the pre-zones behaviour
 * is preserved (Dhaka ৳100 / elsewhere ৳150) so checkout can never break.
 */
import { prisma } from "@/lib/prisma";
import {
  normalizePlace,
  pickZone,
  type PublicZone,
} from "./zone-shared";

export {
  normalizePlace,
  pickZone,
  dhakaZone,
  defaultZone,
  type PublicZone,
} from "./zone-shared";

export interface ResolvedZone {
  id: string | null;
  name: string;
  code: string | null;
  rate: number;
  isDefault: boolean;
}

const LEGACY_INSIDE_RATE = 100;
const LEGACY_OUTSIDE_RATE = 150;

export async function listActiveZones(): Promise<PublicZone[]> {
  const zones = await prisma.delivery_zones.findMany({
    where: { is_active: true },
    orderBy: [{ sort_order: "asc" }, { name: "asc" }],
  });
  return zones.map((z) => ({
    id: z.id,
    name: z.name,
    code: z.code,
    rate: Number(z.rate ?? 0),
    districts: z.districts ?? [],
    is_default: z.is_default,
    sort_order: z.sort_order,
  }));
}

export async function resolveZoneForAddress(input: {
  district?: string | null;
  city?: string | null;
}): Promise<ResolvedZone> {
  try {
    const zones = await listActiveZones();
    const zone = pickZone(zones, input.district, input.city);
    if (zone) {
      return {
        id: zone.id,
        name: zone.name,
        code: zone.code,
        rate: zone.rate,
        isDefault: zone.is_default,
      };
    }
  } catch (err) {
    console.error("[zone-resolution] lookup failed, using legacy rates", err);
  }
  // No zones configured — preserve the historical flat schedule.
  const isDhaka =
    normalizePlace(input.district) === "dhaka" ||
    normalizePlace(input.city) === "dhaka";
  return {
    id: null,
    name: isDhaka ? "Inside Dhaka" : "Outside Dhaka",
    code: null,
    rate: isDhaka ? LEGACY_INSIDE_RATE : LEGACY_OUTSIDE_RATE,
    isDefault: !isDhaka,
  };
}

export async function resolveShippingCharge(input: {
  district?: string | null;
  city?: string | null;
}): Promise<{ zone: ResolvedZone; charge: number }> {
  const zone = await resolveZoneForAddress(input);
  return { zone, charge: zone.rate };
}
