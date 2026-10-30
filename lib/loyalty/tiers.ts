/**
 * Canonical loyalty tier ladder — the SINGLE source of truth for tiers.
 *
 * S6-2: three conflicting definitions had grown up independently —
 *   · the admin "Loyalty & Tiers" tab (SILVER 0 / GOLD 1,000 /
 *     PLATINUM 5,000 / VIP 20,000 lifetime points),
 *   · LoyaltyService's earn/reverse ladder (GOLD at 2,000, VIP at
 *     10,000), which is what actually got written to loyalty_accounts,
 *   · the storefront loyalty page (a MEMBER/BRONZE/… ladder with GOLD
 *     at 15,000), plus an admin customer LIST that labelled anyone with
 *     lifetime spend over ৳5,000 "Platinum" regardless of points.
 * The same 57-point customer rendered as PLATINUM (list), Silver
 * (detail) and SILVER-with-14,943-points-to-GOLD (storefront).
 *
 * The admin tiers tab is the merchant-facing definition of the program,
 * so its ladder is canonical. Every surface — the tiers tab itself,
 * the service that stamps loyalty_accounts.tier, the admin list and
 * detail, and the storefront page — derives from this module.
 */

export type LoyaltyTierName = "SILVER" | "GOLD" | "PLATINUM" | "VIP";

export interface LoyaltyTierDef {
  tier: LoyaltyTierName;
  /** Lifetime earned points required to hold this tier. */
  minPoints: number;
  benefits: string[];
  color: string;
}

export const LOYALTY_TIERS: LoyaltyTierDef[] = [
  {
    tier: "SILVER",
    minPoints: 0,
    benefits: ["Basic support", "5% discount on birthdays"],
    color: "bg-slate-300",
  },
  {
    tier: "GOLD",
    minPoints: 1000,
    benefits: ["Priority support", "Free shipping", "10% discount on birthdays"],
    color: "bg-yellow-400",
  },
  {
    tier: "PLATINUM",
    minPoints: 5000,
    benefits: ["Dedicated manager", "Free express shipping", "Early access to sales"],
    color: "bg-slate-800 text-white",
  },
  {
    tier: "VIP",
    minPoints: 20000,
    benefits: ["All Platinum benefits", "Exclusive event invites", "Personal stylist"],
    color: "bg-purple-900 text-white",
  },
];

/** The tier a customer holds for a given lifetime-earned-points total. */
export function tierForLifetimePoints(totalEarned: number): LoyaltyTierName {
  const pts = Number(totalEarned) || 0;
  let current: LoyaltyTierName = "SILVER";
  for (const def of LOYALTY_TIERS) {
    if (pts >= def.minPoints) current = def.tier;
  }
  return current;
}

export interface NextTierProgress {
  tier: LoyaltyTierName;
  next: LoyaltyTierName;
  threshold: number;
  pointsNeeded: number;
}

/** Progress toward the next tier, or null at the top of the ladder. */
export function nextTierProgress(totalEarned: number): NextTierProgress | null {
  const pts = Number(totalEarned) || 0;
  const tier = tierForLifetimePoints(pts);
  const idx = LOYALTY_TIERS.findIndex((d) => d.tier === tier);
  const next = LOYALTY_TIERS[idx + 1];
  if (!next) return null;
  return {
    tier,
    next: next.tier,
    threshold: next.minPoints,
    pointsNeeded: Math.max(next.minPoints - pts, 0),
  };
}

/** "SILVER" → "Silver" (the casing the badges/detail header render). */
export function tierTitleCase(tier: string): string {
  const t = String(tier || "SILVER").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
