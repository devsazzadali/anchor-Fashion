"use server";

/**
 * Homepage manageability (Workstream D).
 *
 * Two DB-backed settings documents (in the `settings` table) complete the
 * Phase-9 CMS so EVERY visible homepage block is admin-controllable:
 *
 *  1. `homepage_layout` — per-section visibility + ordering for the blocks
 *     the homepage renders (hero slides, banners, collections, curated
 *     showcase etc. already have their own CMS editors; this controls
 *     whether each block appears at all, and in what order within its
 *     layout group).
 *  2. `homepage_features` — the Features Bar (Free Delivery / Easy Returns
 *     / Premium Quality / Secure Checkout), which used to be hardcoded in
 *     components/home/features-bar.tsx — copy, icons and visibility are
 *     now editable from Admin → CMS → Homepage.
 *
 * Defaults reproduce today's homepage exactly.
 */
import { createDbClient, createAdminDbClient } from "@/lib/db/client";
import { verifyStaff } from "@/lib/security/roles";
import { revalidatePath, revalidateTag } from "next/cache";
import {
  DEFAULT_FEATURES_BAR,
  HOMEPAGE_SECTIONS,
  type FeaturesBarConfig,
  type HomepageLayout,
} from "@/lib/homepage-shared";

export type {
  FeaturesBarConfig,
  FeatureBarItem,
  HomepageLayout,
  HomepageSectionSetting,
} from "@/lib/homepage-shared";

async function readSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const db = createDbClient();
    const { data } = await db.from("settings").select("value").eq("key", key).single();
    if (data?.value && typeof data.value === "object") {
      return { ...fallback, ...(data.value as any) };
    }
    return fallback;
  } catch {
    return fallback;
  }
}

async function writeSetting(key: string, value: any, description: string) {
  const db = createAdminDbClient();
  const { error } = await db
    .from("settings")
    .upsert({ key, value, description }, { onConflict: "key" });
  if (error) throw error;
  try {
    revalidateTag("settings", "max");
    revalidatePath("/", "page");
    revalidatePath("/admin/cms/homepage");
  } catch {}
}

/** Merge a stored layout with the registry: stored order wins, unknown
 *  keys are dropped, sections missing from storage keep default position. */
function normalizeLayout(stored: HomepageLayout | null): HomepageLayout {
  const registry = HOMEPAGE_SECTIONS.map((s) => s.key);
  const storedSections = (stored?.sections || []).filter((s) =>
    registry.includes(s.key)
  );
  const seen = new Set(storedSections.map((s) => s.key));
  const merged = [
    ...storedSections.map((s) => ({ key: s.key, isEnabled: s.isEnabled !== false })),
    ...registry
      .filter((k) => !seen.has(k))
      .map((k) => ({ key: k, isEnabled: true })),
  ];
  return { sections: merged };
}

export async function getHomepageLayout(): Promise<HomepageLayout> {
  const stored = await readSetting<HomepageLayout | null>("homepage_layout", null);
  return normalizeLayout(stored);
}

export async function updateHomepageLayout(layout: HomepageLayout) {
  try {
    await verifyStaff();
    const clean = normalizeLayout(layout);
    await writeSetting(
      "homepage_layout",
      clean,
      "Homepage section visibility and ordering"
    );
    return { success: true };
  } catch (err: any) {
    console.error("[updateHomepageLayout]", err);
    return { success: false, error: err.message || "Failed to save layout" };
  }
}

export async function getFeaturesBarConfig(): Promise<FeaturesBarConfig> {
  const stored = await readSetting<FeaturesBarConfig>(
    "homepage_features",
    DEFAULT_FEATURES_BAR
  );
  return {
    isEnabled: stored.isEnabled !== false,
    items:
      Array.isArray(stored.items) && stored.items.length > 0
        ? stored.items.slice(0, 4).map((it) => ({
            icon: String(it.icon || "Truck"),
            title: String(it.title || ""),
            description: String(it.description || ""),
          }))
        : DEFAULT_FEATURES_BAR.items,
  };
}

export async function updateFeaturesBarConfig(config: FeaturesBarConfig) {
  try {
    await verifyStaff();
    const clean: FeaturesBarConfig = {
      isEnabled: config.isEnabled !== false,
      items: (config.items || []).slice(0, 4).map((it) => ({
        icon: String(it.icon || "Truck").trim() || "Truck",
        title: String(it.title || "").trim(),
        description: String(it.description || "").trim(),
      })),
    };
    await writeSetting(
      "homepage_features",
      clean,
      "Homepage features bar items (icon, title, description)"
    );
    return { success: true };
  } catch (err: any) {
    console.error("[updateFeaturesBarConfig]", err);
    return { success: false, error: err.message || "Failed to save features bar" };
  }
}
