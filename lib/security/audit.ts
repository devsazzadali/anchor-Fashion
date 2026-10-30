import { prisma } from "@/lib/prisma";

/**
 * REG-27: audit_logs was decorative — the only writer in the codebase
 * was the warehouse service, so the Audit Logs page showed 8 warehouse
 * test rows and nothing else. This module is now the ONE writer every
 * key admin action uses. It targets the real `audit_logs` table shape
 * (Prisma `AuditLog`): userId, action, entity, entityId, oldValues,
 * newValues, ipAddress, createdAt.
 *
 * The previous implementation in this file (`logSecurityEvent`) was
 * dead code — zero callers — and inserted columns that do not exist
 * (event_type / actor_id / metadata / user_agent), so it would have
 * errored had anything ever called it. It is replaced by recordAudit.
 *
 * Rules:
 *  - actor is ALWAYS the acting user's profile id — never "System"
 *    for a human action.
 *  - auditing must never break the action it records: failures are
 *    logged to the server console and swallowed.
 */
export async function recordAudit(entry: {
  userId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
  ipAddress?: string | null;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        oldValues: (entry.oldValues ?? undefined) as any,
        newValues: (entry.newValues ?? undefined) as any,
        ipAddress: entry.ipAddress ?? null,
      },
    });
  } catch (err) {
    console.error("[audit] failed to record audit event:", entry.action, err);
  }
}

/**
 * REG-27: resolve the acting user from the current Neon Auth session
 * and record an audit row for them. The audit_logs.userId column is a
 * FK to profiles.id, and profile ids are the auth ids for provisioned
 * accounts; fall back to an email match for legacy profiles whose id
 * predates the re-keying. If no profile resolves, the row is skipped
 * (a null actor would read as "System", which human actions must
 * never claim).
 */
export async function recordAuditForSessionUser(entry: {
  action: string;
  entity: string;
  entityId?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
  ipAddress?: string | null;
}): Promise<void> {
  try {
    const { getServerSession } = await import("@/lib/auth/server");
    const { user } = await getServerSession();
    if (!user?.id) return;

    const profile = await prisma.profile.findFirst({
      where: {
        OR: [
          { id: user.id },
          ...(user.email ? [{ email: user.email }] : []),
        ],
      },
      select: { id: true },
    });
    if (!profile) return;

    await recordAudit({ ...entry, userId: profile.id });
  } catch (err) {
    console.error("[audit] session actor resolution failed:", entry.action, err);
  }
}

/** Canonical audit action names (warehouse history used the same style). */
export const AUDIT_ACTIONS = {
  USER_SIGNED_IN: "USER_SIGNED_IN",
  ORDER_STATUS_CHANGED: "ORDER_STATUS_CHANGED",
  PRODUCT_CREATED: "PRODUCT_CREATED",
  PRODUCT_UPDATED: "PRODUCT_UPDATED",
  SETTINGS_UPDATED: "SETTINGS_UPDATED",
  USER_CREATED: "USER_CREATED",
  USER_DEACTIVATED: "USER_DEACTIVATED",
  USER_ACTIVATED: "USER_ACTIVATED",
  CAMPAIGN_SENT: "CAMPAIGN_SENT",
} as const;
