/**
 * Date/time formatting pinned to the store's timezone (Asia/Dhaka).
 *
 * Server runtimes (Vercel) execute in UTC, so formatting an order's
 * timestamp with the Date getters (getHours(), getDate(), ...) prints
 * UTC wall-clock time — the Mushak invoice showed "12:00:29" for an
 * order placed at 6:00:29 PM Dhaka time (S5-6). These helpers always
 * render in Asia/Dhaka regardless of the host timezone.
 */

export const STORE_TIME_ZONE = "Asia/Dhaka";

interface DhakaParts {
  day: string;
  month: string;
  year: string;
  hour: string;
  minute: string;
  second: string;
  dayPeriod: string;
}

function dhakaParts(date: Date): DhakaParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: STORE_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";

  return {
    day: get("day"),
    month: get("month"),
    year: get("year"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
    dayPeriod: get("dayPeriod").toUpperCase(),
  };
}

/** "DD-MM-YYYY" in Asia/Dhaka. */
export function formatDhakaDate(date: Date): string {
  const p = dhakaParts(date);
  return `${p.day}-${p.month}-${p.year}`;
}

/** "h:mm:ss AM/PM" in Asia/Dhaka. */
export function formatDhakaTime(date: Date): string {
  const p = dhakaParts(date);
  return `${p.hour}:${p.minute}:${p.second} ${p.dayPeriod}`;
}

/** Numeric parts (DD, MM, YYYY) in Asia/Dhaka — for composed values like barcodes. */
export function dhakaDateParts(date: Date): {
  day: string;
  month: string;
  year: string;
} {
  const p = dhakaParts(date);
  return { day: p.day, month: p.month, year: p.year };
}
