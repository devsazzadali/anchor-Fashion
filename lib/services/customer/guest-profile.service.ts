/**
 * Guest auto-profiles (Phase 12 — hybrid checkout).
 *
 * Anchor is Daraz-model: guests check out with NO registration wall, and the
 * phone number is the customer's identity. When a guest order is placed, the
 * system silently find-or-creates a CUSTOMER profile keyed by the NORMALIZED
 * phone (AlphaSmsService format: 8801XXXXXXXXX) and links the order to it, so
 * every order belongs to a customer profile the admin can see — while the
 * customer never hit a signup form.
 *
 * These profiles are UNCLAIMED: this service never creates auth credentials
 * and never sets a password. A profile becomes loggable only through the
 * account-claim flow (phone OTP proof + customer-chosen password), which
 * creates the Neon Auth user and rebinds the profile to it.
 */
import { prisma } from "@/lib/prisma";
import { AlphaSmsService } from "@/lib/services/sms/alpha-sms.service";

const ELEVATED_ROLES = new Set([
  "ADMIN",
  "SUPERADMIN",
  "MANAGER",
  "FINANCE_MANAGER",
  "MARKETING",
  "MARKETING_MANAGER",
  "STAFF",
  "SUPPORT",
  "WAREHOUSE_MANAGER",
]);

export interface GuestIdentity {
  phone?: string | null;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  /** True when this checkout passed the COD OTP verification gate. */
  phoneVerified?: boolean;
}

export function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;
  const { valid, normalized } = AlphaSmsService.normalizePhoneNumber(raw);
  return valid ? normalized : null;
}

let cachedCustomerRoleId: string | null | undefined;
async function customerRoleId(): Promise<string | null> {
  if (cachedCustomerRoleId !== undefined) return cachedCustomerRoleId;
  const role = await prisma.role
    .findFirst({
      where: { name: { equals: "CUSTOMER", mode: "insensitive" } },
      select: { id: true },
    })
    .catch(() => null);
  cachedCustomerRoleId = role?.id ?? null;
  return cachedCustomerRoleId;
}

function isCustomerProfile(profile: {
  role?: { name?: string | null } | null;
  roleId?: string | null;
}): boolean {
  const name = profile.role?.name?.toUpperCase();
  if (name) return !ELEVATED_ROLES.has(name);
  return true; // no role recorded → treat as customer (never a staff row)
}

/**
 * Find the customer profile that owns a normalized BD phone number, however
 * the number was stored (8801…, 01…, +8801…). Staff profiles are never
 * matched. When several customer profiles share the number (legacy data),
 * the one with the most orders wins; ties break to the oldest profile.
 */
export async function findProfileByNormalizedPhone(
  normalized: string
): Promise<any | null> {
  const last9 = normalized.slice(-9);
  const candidates = await prisma.profile.findMany({
    where: { phone: { endsWith: last9 } },
    include: { role: { select: { name: true } } },
  });

  const matches = candidates.filter(
    (p) => isCustomerProfile(p) && normalizePhone(p.phone) === normalized
  );
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  const withCounts = await Promise.all(
    matches.map(async (p) => ({
      profile: p,
      orders: await prisma.order.count({ where: { profileId: p.id } }),
    }))
  );
  withCounts.sort(
    (a, b) =>
      b.orders - a.orders ||
      a.profile.createdAt.getTime() - b.profile.createdAt.getTime()
  );
  return withCounts[0].profile;
}

/** Fill still-empty fields of an existing profile from checkout data. */
export async function enrichProfileFromCheckout(
  profileId: string,
  identity: GuestIdentity
): Promise<void> {
  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
  });
  if (!profile) return;

  const data: Record<string, any> = {};
  const normalized = normalizePhone(identity.phone);
  if (!profile.phone && normalized) data.phone = normalized;
  if (!profile.firstName && identity.firstName) data.firstName = identity.firstName;
  if (!profile.lastName && identity.lastName) data.lastName = identity.lastName;
  if (!profile.email && identity.email) {
    const taken = await prisma.profile.findUnique({
      where: { email: identity.email },
      select: { id: true },
    });
    if (!taken) data.email = identity.email;
  }
  if (!profile.roleId) {
    const roleId = await customerRoleId();
    if (roleId) data.roleId = roleId;
  }
  if (identity.phoneVerified && !profile.phoneVerifiedAt && normalized) {
    // Only stamp verification when the number on file is the verified one.
    if (!profile.phone || normalizePhone(profile.phone) === normalized) {
      data.phoneVerifiedAt = new Date();
    }
  }
  if (Object.keys(data).length > 0) {
    await prisma.profile.update({ where: { id: profileId }, data });
  }
}

/**
 * Find-or-create the guest profile for a checkout identity. Keyed by the
 * normalized phone. Returns null when the phone is missing/invalid (the
 * caller must then leave the order unlinked rather than block it).
 */
export async function findOrCreateGuestProfile(
  identity: GuestIdentity
): Promise<any | null> {
  const normalized = normalizePhone(identity.phone);
  if (!normalized) return null;

  const existing = await findProfileByNormalizedPhone(normalized);
  if (existing) {
    await enrichProfileFromCheckout(existing.id, identity);
    return existing;
  }

  // Email is unique across profiles: attach it only when still unclaimed,
  // otherwise the profile is created phone-only (claim flow can add email).
  let email: string | null = null;
  if (identity.email) {
    const taken = await prisma.profile.findUnique({
      where: { email: identity.email },
      select: { id: true },
    });
    if (!taken) email = identity.email;
  }

  const roleId = await customerRoleId();
  return prisma.profile.create({
    data: {
      email,
      firstName: identity.firstName || null,
      lastName: identity.lastName || null,
      phone: normalized,
      roleId,
      isActive: true,
      phoneVerifiedAt: identity.phoneVerified ? new Date() : null,
    },
  });
}
