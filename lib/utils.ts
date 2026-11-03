import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency: string = "৳"): string {
  if (amount === undefined || amount === null) return `${currency}0`;
  const symbol = currency.includes("(") ? currency.match(/\((.*?)\)/)?.[1] || currency : currency;
  // Display-only whole-taka rounding: customers never see paisa fractions
  // (e.g. ৳4,987.5). Stored amounts and VAT math keep 2dp paisa precision
  // (lib/utils/vat.ts) — this formatter only produces display strings and
  // its output is never fed back into arithmetic.
  const rounded = Math.round(Number(amount));
  return `${symbol}${rounded.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
export function formatNumber(number: number | string): string {
  if (number === undefined || number === null) return "0";
  return new Intl.NumberFormat("en-US").format(Number(number));
}
