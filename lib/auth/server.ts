import { cache } from "react";
import { randomBytes } from "crypto";
import { createNeonAuth } from "@neondatabase/auth/next/server";
import { prisma } from "@/lib/prisma";

const isProduction = process.env.NODE_ENV === "production";
// `next build` evaluates server modules without runtime secrets; only enforce at runtime.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
const authCookieSecret = process.env.NEON_AUTH_COOKIE_SECRET;
const authBaseUrl = process.env.NEON_AUTH_BASE_URL;

/**
 * SECURITY: never ship a hardcoded session secret / auth endpoint.
 * - Production runtime: both values MUST come from the environment.
 * - Development / build: an ephemeral random secret is generated per process.
 */
if (isProduction && !isBuildPhase) {
  if (!authBaseUrl) {
    throw new Error("NEON_AUTH_BASE_URL must be set in production.");
  }
  if (!authCookieSecret || authCookieSecret.length < 32) {
    throw new Error(
      "NEON_AUTH_COOKIE_SECRET must be set (min 32 characters) in production."
    );
  }
}

const effectiveAuthBaseUrl = authBaseUrl || "http://localhost:0/auth-not-configured";
const effectiveAuthCookieSecret =
  authCookieSecret && authCookieSecret.length >= 32
    ? authCookieSecret
    : randomBytes(32).toString("base64");

export const auth = createNeonAuth({
  baseUrl: effectiveAuthBaseUrl,
  cookies: {
    secret: effectiveAuthCookieSecret,
  },
});

export interface NeonAuthSessionUser {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
  role?: string | null;
  // Carried by the hosted auth record and read by the guarded role
  // resolver (resolveUserRole) and the deactivation check below.
  emailVerified?: boolean | null;
  // Auth metadata bag; checkout reads its role fallback from here.
  user_metadata?: { role?: string | null; [key: string]: unknown } | null;
  [key: string]: unknown;
}

// Shape of the hosted session payload getServerSession unwraps: either
// the wrapped `data` object or, defensively, the result itself.
interface NeonAuthSessionPayload {
  user?: NeonAuthSessionUser | null;
  session?: Record<string, unknown> | null;
}

/**
 * Deduplicated and indexed role resolution.
 * Uses point-lookup by unique email / id.
 *
 * SECURITY: the profile is looked up by email, and sign-up is open. An elevated
 * (non-customer) role is therefore only honored when the profile row is bound to
 * this auth user's id (ids cannot be chosen at sign-up) OR the auth email has been
 * verified. Otherwise anyone could register a staff member's email address and
 * inherit that profile's role.
 *
 * A3-A4: the role on the raw Neon Auth user object is NEVER trusted — an
 * earlier fast path returned any elevated `user.role` immediately, before
 * the identity-binding guard below, so a self-registered user who managed
 * to get an elevated role onto their hosted auth record would have skipped
 * the guard entirely. The role now comes ONLY from the identity-bound
 * profiles record; the raw auth role is not consulted at all.
 */
export const resolveUserRole = cache(
  async (user: {
    id?: string | null;
    email?: string | null;
    role?: string | null;
    emailVerified?: boolean | null;
  }): Promise<string> => {
    if (!user) return "CUSTOMER";
    let role = "CUSTOMER";

    try {
      const email = user.email ? user.email.toLowerCase().trim() : undefined;
      const isUuid =
        user.id &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id);

      // Fast single-key index lookup (findUnique instead of findFirst with OR)
      const profile = email
        ? await prisma.profile.findUnique({
            where: { email },
            select: { id: true, role: { select: { name: true } } },
          })
        : isUuid
        ? await prisma.profile.findUnique({
            where: { id: user.id! },
            select: { id: true, role: { select: { name: true } } },
          })
        : null;

      if (profile?.role?.name) {
        const resolved = profile.role.name.toUpperCase().trim();
        const isElevated = resolved !== "CUSTOMER" && resolved !== "USER";
        const identityBound =
          (!!user.id && profile.id === user.id) || user.emailVerified === true;

        if (isElevated && !identityBound) {
          role = "CUSTOMER";
        } else {
          role = resolved;
        }
      } else {
        role = "CUSTOMER";
      }
    } catch (err) {
      if (!role || role === "USER") role = "CUSTOMER";
    }

    return role || "CUSTOMER";
  }
);

/**
 * Deduplicated session fetch within a single request.
 * Wrapped in React.cache to avoid repeating HTTP calls and DB lookups across layout and page.
 *
 * REG-65 holdout: the session value flows through lib/db/auth.ts into
 * consumers that read session.user, while the client branch of that
 * helper yields a session record with no user field — typing this
 * return member errors in three consumer files outside this batch's
 * scope. Reconciling the two session shapes is a functional fix.
 */
export const getServerSession = cache(
  async (): Promise<{
    user: NeonAuthSessionUser | null;
    session: any | null;
  }> => {
    try {
      const res = await auth.getSession();
      const data = (res as { data?: NeonAuthSessionPayload | null })?.data ?? res;
      const user = (data as NeonAuthSessionPayload)?.user ?? null;
      const session = (data as NeonAuthSessionPayload)?.session ?? null;

      if (user) {
        const resolvedRole = await resolveUserRole(user);

        // R30 FIX2 (item 7 follow-up): enforce admin deactivation. The users
        // UI's "Deactivate User" only flipped profiles.is_active — nothing
        // consulted it, so a deactivated staff account could still sign in
        // and use the /manager console. Treat a deactivated, identity-bound
        // profile as signed out everywhere getServerSession is the gate
        // (admin/manager/customer layouts + role guards + server actions).
        // The identity-binding mirrors resolveUserRole's guard so an
        // unverified look-alike registration cannot be used to lock out —
        // or be locked by — someone else's profile row.
        try {
          const email = user.email
            ? user.email.toLowerCase().trim()
            : undefined;
          const profile = email
            ? await prisma.profile.findUnique({
                where: { email },
                select: { id: true, isActive: true },
              })
            : null;
          const identityBound =
            !!profile &&
            ((!!user.id && profile.id === user.id) ||
              user.emailVerified === true);
          if (profile && identityBound && profile.isActive === false) {
            return { user: null, session: null };
          }
        } catch {
          // Fail open on lookup errors, mirroring resolveUserRole.
        }

        return {
          user: {
            ...user,
            role: resolvedRole,
          },
          session,
        };
      }

      return { user: null, session: null };
    } catch (err) {
      return { user: null, session: null };
    }
  }
);
