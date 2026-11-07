"use server";

/**
 * Delivery-zone actions (Workstream C rewrite).
 *
 * Zones are stored in the `delivery_zones` table and are the single source
 * of truth for delivery charges at checkout. Admins manage them from
 * Settings → Store → "Shipping Zones & Rates": name, code, flat charge,
 * covered districts, default flag, sort order and active state.
 *
 * This module previously read a `shipping_rates` relation and zone columns
 * (description / estimated_days / is_cod_available) that never existed in
 * the database, so the settings page could only render an empty state and
 * checkout quietly used hardcoded ৳100/৳150 constants. All of that is now
 * backed by the real table via Prisma.
 */
import { prisma } from "@/lib/prisma";
import { verifySuperAdmin } from "@/lib/security/roles";
import { revalidatePath } from "next/cache";
import {
  listActiveZones,
  type PublicZone,
} from "@/lib/services/shipping/zone-resolution.service";

export type AdminZone = PublicZone & { is_active: boolean };

export interface ZoneInput {
  name: string;
  code: string;
  rate: number;
  districts: string[];
  is_default: boolean;
  is_active: boolean;
  sort_order: number;
}

type ActionResult<T = void> = T extends void
  ? { success: true } | { success: false; error: string }
  : { success: true; data: T } | { success: false; error: string };

function normalizeCode(raw: string): string {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function validateZoneInput(input: ZoneInput): string | null {
  if (!input.name?.trim()) return "Zone name is required.";
  if (!normalizeCode(input.code)) return "Zone code is required.";
  if (!Number.isFinite(input.rate) || input.rate < 0)
    return "Delivery charge must be a number ≥ 0.";
  return null;
}

function revalidateZoneConsumers() {
  try {
    revalidatePath("/admin/settings/store");
    revalidatePath("/admin/shipping/zones");
    revalidatePath("/checkout");
    revalidatePath("/", "layout");
  } catch {}
}

/** Public: active zones for checkout display (no admin data leaks). */
export async function getPublicZonesAction(): Promise<{
  success: boolean;
  data: PublicZone[];
}> {
  try {
    return { success: true, data: await listActiveZones() };
  } catch (err) {
    console.error("[getPublicZonesAction]", err);
    return { success: false, data: [] };
  }
}

/** Admin: every zone (active + inactive), in display order. */
export async function getAdminZonesAction(): Promise<
  ActionResult<AdminZone[]>
> {
  try {
    await verifySuperAdmin();
    const zones = await prisma.delivery_zones.findMany({
      orderBy: [{ sort_order: "asc" }, { name: "asc" }],
    });
    return {
      success: true,
      data: zones.map((z) => ({
        id: z.id,
        name: z.name,
        code: z.code,
        rate: Number(z.rate ?? 0),
        districts: z.districts ?? [],
        is_default: z.is_default,
        is_active: z.is_active !== false,
        sort_order: z.sort_order,
      })),
    };
  } catch (err: any) {
    console.error("[getAdminZonesAction]", err);
    return { success: false, error: err.message || "Failed to load zones" };
  }
}

export async function createZoneAction(
  input: ZoneInput
): Promise<ActionResult<{ id: string }>> {
  try {
    await verifySuperAdmin();
    const invalid = validateZoneInput(input);
    if (invalid) return { success: false, error: invalid };

    const zone = await prisma.$transaction(async (tx) => {
      if (input.is_default) {
        await tx.delivery_zones.updateMany({ data: { is_default: false } });
      }
      return tx.delivery_zones.create({
        data: {
          name: input.name.trim(),
          code: normalizeCode(input.code),
          rate: input.rate,
          districts: input.districts.map((d) => d.trim()).filter(Boolean),
          is_default: input.is_default,
          is_active: input.is_active,
          sort_order: input.sort_order || 0,
        },
      });
    });

    revalidateZoneConsumers();
    return { success: true, data: { id: zone.id } };
  } catch (err: any) {
    console.error("[createZoneAction]", err);
    if (String(err?.code) === "P2002") {
      return { success: false, error: "A zone with this code already exists." };
    }
    return { success: false, error: err.message || "Failed to create zone" };
  }
}

export async function updateZoneAction(
  id: string,
  input: ZoneInput
): Promise<ActionResult> {
  try {
    await verifySuperAdmin();
    const invalid = validateZoneInput(input);
    if (invalid) return { success: false, error: invalid };

    await prisma.$transaction(async (tx) => {
      if (input.is_default) {
        await tx.delivery_zones.updateMany({
          where: { id: { not: id } },
          data: { is_default: false },
        });
      }
      await tx.delivery_zones.update({
        where: { id },
        data: {
          name: input.name.trim(),
          code: normalizeCode(input.code),
          rate: input.rate,
          districts: input.districts.map((d) => d.trim()).filter(Boolean),
          is_default: input.is_default,
          is_active: input.is_active,
          sort_order: input.sort_order || 0,
          updated_at: new Date(),
        },
      });
    });

    revalidateZoneConsumers();
    return { success: true };
  } catch (err: any) {
    console.error("[updateZoneAction]", err);
    if (String(err?.code) === "P2002") {
      return { success: false, error: "A zone with this code already exists." };
    }
    return { success: false, error: err.message || "Failed to update zone" };
  }
}

export async function deleteZoneAction(id: string): Promise<ActionResult> {
  try {
    await verifySuperAdmin();
    const zone = await prisma.delivery_zones.findUnique({ where: { id } });
    if (!zone) return { success: false, error: "Zone not found." };
    if (zone.is_default) {
      return {
        success: false,
        error:
          "The default zone cannot be deleted. Make another zone the default first.",
      };
    }
    const count = await prisma.delivery_zones.count();
    if (count <= 1) {
      return { success: false, error: "At least one delivery zone must exist." };
    }
    await prisma.delivery_zones.delete({ where: { id } });
    revalidateZoneConsumers();
    return { success: true };
  } catch (err: any) {
    console.error("[deleteZoneAction]", err);
    return { success: false, error: err.message || "Failed to delete zone" };
  }
}
