/**
 * Inventory-audit date handling.
 *
 * `inventory_audits` has no scheduled-date column: when an audit is
 * scheduled, the picked calendar date is preserved in the row's notes as
 * "Scheduled for YYYY-MM-DD" (see InventoryRepository.createAudit). The
 * audits list previously ignored that and formatted `created_at` — a UTC
 * timestamp — in the viewer's local timezone, so an audit scheduled for
 * Oct 31 displayed as "October 30th" (its creation date, shifted again
 * for viewers west of UTC).
 *
 * These helpers make the PICKED calendar date the displayed date:
 * the ISO date is treated as a pure calendar date (no timezone
 * conversion), and the created_at fallback is rendered in the business
 * timezone (Asia/Dhaka).
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function ordinal(day: number): string {
  if (day >= 11 && day <= 13) return `${day}th`;
  switch (day % 10) {
    case 1: return `${day}st`;
    case 2: return `${day}nd`;
    case 3: return `${day}rd`;
    default: return `${day}th`;
  }
}

function formatCalendarDate(year: number, month1to12: number, day: number): string {
  return `${MONTHS[month1to12 - 1]} ${ordinal(day)}, ${year}`;
}

/**
 * The calendar date the user picked for this audit ("YYYY-MM-DD"), from
 * the row's scheduled_date if one is ever present, else parsed from the
 * "Scheduled for …" note written at creation time. Null when the audit
 * carries no scheduled date.
 */
export function auditScheduledISODate(audit: {
  scheduled_date?: unknown;
  notes?: unknown;
}): string | null {
  const raw = audit?.scheduled_date;
  if (typeof raw === "string") {
    const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    // A real timestamp: its Asia/Dhaka calendar date is the picked date.
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Dhaka",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(raw);
    const get = (t: string) => parts.find((p) => p.type === t)?.value;
    if (get("year") && get("month") && get("day")) {
      return `${get("year")}-${get("month")}-${get("day")}`;
    }
  }
  const notes = typeof audit?.notes === "string" ? audit.notes : "";
  const m = notes.match(/Scheduled for (\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/**
 * Display string for an audit's date: the picked calendar date when one
 * exists, otherwise the creation date in Asia/Dhaka. "—" when neither.
 */
export function formatAuditDate(audit: {
  scheduled_date?: unknown;
  created_at?: unknown;
  notes?: unknown;
}): string {
  const iso = auditScheduledISODate(audit);
  if (iso) {
    const [y, m, d] = iso.split("-").map(Number);
    if (y && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return formatCalendarDate(y, m, d);
    }
  }
  const created = audit?.created_at;
  if (created) {
    const dt = created instanceof Date ? created : new Date(created as any);
    if (!isNaN(dt.getTime())) {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Dhaka",
        year: "numeric",
        month: "numeric",
        day: "numeric",
      }).formatToParts(dt);
      const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
      if (get("year") && get("month") && get("day")) {
        return formatCalendarDate(get("year"), get("month"), get("day"));
      }
    }
  }
  return "—";
}
