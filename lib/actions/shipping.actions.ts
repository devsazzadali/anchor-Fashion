"use server";

import { createDbClient } from "@/lib/db/client";
import { createAdminDbClient } from "@/lib/db/client";
import { verifySuperAdmin } from "@/lib/security/roles";
import { revalidatePath } from "next/cache";

export type DeliveryZone = {
  id: string;
  name: string;
  code: string;
  description?: string;
  districts: string[];
  is_cod_available: boolean;
  is_active: boolean;
  estimated_days_min: number;
  estimated_days_max: number;
};

export type ShippingRate = {
  id: string;
  zone_id: string;
  name: string;
  base_rate: number;
  free_shipping_above?: number | null;
  is_cod_rate: boolean;
  cod_charge: number;
  is_active: boolean;
};

export async function getDeliveryZonesWithRates() {
  const db = await createDbClient();
  const { data: zones, error } = await db
    .from("delivery_zones")
    .select(`
      *,
      shipping_rates (*)
    `)
    .eq("is_active", true)
    .order("name");

  if (error) {
    console.error("[getDeliveryZonesWithRates]", error);
    return { success: false, data: null, error: error.message };
  }
  return { success: true, data: zones };
}

export async function getPublicShippingRates() {
  const db = await createDbClient();
  const { data, error } = await db
    .from("delivery_zones")
    .select(`
      id,
      name,
      code,
      districts,
      estimated_days_min,
      estimated_days_max,
      shipping_rates (
        id,
        name,
        base_rate,
        free_shipping_above,
        cod_charge,
        is_cod_rate
      )
    `)
    .eq("is_active", true)
    .eq("shipping_rates.is_active", true);

  if (error) {
    console.error("[getPublicShippingRates]", error);
    return { success: false, data: null };
  }
  return { success: true, data };
}

export async function upsertShippingRate(
  rate: Partial<ShippingRate> & { zone_id: string; name: string; base_rate: number }
) {
  try {
    await verifySuperAdmin();
    const db = createAdminDbClient();
    const { data, error } = await db
      .from("shipping_rates")
      .upsert(rate, { onConflict: "id" })
      .select()
      .single();
    if (error) throw error;
    revalidatePath("/admin/settings/store");
    revalidatePath("/", "layout");
    return { success: true, data };
  } catch (error: any) {
    console.error("[upsertShippingRate]", error);
    return { success: false, error: error.message };
  }
}

export async function toggleShippingRate(rateId: string, isActive: boolean) {
  try {
    await verifySuperAdmin();
    const db = createAdminDbClient();
    const { error } = await db
      .from("shipping_rates")
      .update({ is_active: isActive })
      .eq("id", rateId);
    if (error) throw error;
    revalidatePath("/admin/settings/store");
    return { success: true };
  } catch (error: any) {
    console.error("[toggleShippingRate]", error);
    return { success: false, error: error.message };
  }
}

export async function upsertDeliveryZone(zone: Partial<DeliveryZone> & { name: string; code: string }) {
  try {
    await verifySuperAdmin();
    const db = createAdminDbClient();
    const { data, error } = await db
      .from("delivery_zones")
      .upsert(zone, { onConflict: "code" })
      .select()
      .single();
    if (error) throw error;
    revalidatePath("/admin/settings/store");
    revalidatePath("/", "layout");
    return { success: true, data };
  } catch (error: any) {
    console.error("[upsertDeliveryZone]", error);
    return { success: false, error: error.message };
  }
}
