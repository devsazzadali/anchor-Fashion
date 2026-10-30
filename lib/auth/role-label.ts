/**
 * REG-34: the ONE display label for a staff role in the manager area.
 * A SUPPORT user was labelled "Store Manager" (the header's name
 * fallback) and saw a "Manager Dashboard Overview" title. Every
 * manager-area surface that names the viewer's role resolves it here.
 */
const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  MANAGER: "Manager",
  STAFF: "Staff",
  SUPPORT: "Support",
  MARKETING: "Marketing",
};

export function roleDisplayLabel(role: string | null | undefined): string {
  const key = String(role || "").toUpperCase().trim();
  if (!key) return "Staff";
  return (
    ROLE_LABELS[key] ??
    key
      .toLowerCase()
      .split("_")
      .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
      .join(" ")
  );
}

/** True for the read-only support role (REG-33). */
export function isSupportRole(role: string | null | undefined): boolean {
  return String(role || "").toUpperCase().trim() === "SUPPORT";
}
