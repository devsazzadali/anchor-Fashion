/**
 * VAT (Value Added Tax) calculations — single source of truth.
 *
 * Anchor Fashion charges VAT per product: every product carries a
 * `vatPercent` rate (e.g. 7.5 means 7.5%). The VAT charge is ADDED ON TOP of
 * the selling price — prices stored on products are VAT-exclusive, and the
 * customer-facing total is selling price + VAT.
 *
 * Every money surface (product display, cart, checkout summary, order
 * creation, POS, invoice) must compute VAT through these helpers so the
 * numbers always agree. All amounts are rounded to 2 decimals (paisa).
 */

/** Round a monetary amount to 2 decimals. */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Normalise a raw vatPercent input: non-finite/negative → 0. */
export function normalizeVatPercent(vatPercent: unknown): number {
  const n = Number(vatPercent);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/**
 * VAT amount for a single monetary amount at the given rate.
 * e.g. vatAmountFor(1000, 7.5) → 75
 */
export function vatAmountFor(amount: number, vatPercent: unknown): number {
  const rate = normalizeVatPercent(vatPercent);
  if (rate === 0 || !Number.isFinite(amount) || amount <= 0) return 0;
  return roundMoney((amount * rate) / 100);
}

/** VAT-inclusive price: selling price with VAT added on top. */
export function priceWithVat(price: number, vatPercent: unknown): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  return roundMoney(price + vatAmountFor(price, vatPercent));
}

/** VAT for one cart/order line: unit price × quantity at the product's rate. */
export function lineVatAmount(
  unitPrice: number,
  quantity: number,
  vatPercent: unknown
): number {
  const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
  return vatAmountFor(unitPrice * qty, vatPercent);
}

/**
 * Total VAT for a set of lines, each with its own per-product rate.
 * Lines are rounded individually (matching how order VAT is audited per
 * line), then summed and rounded again.
 */
export function totalVatAmount(
  lines: Array<{ unitPrice: number; quantity: number; vatPercent?: unknown }>
): number {
  const sum = lines.reduce(
    (acc, line) => acc + lineVatAmount(line.unitPrice, line.quantity, line.vatPercent),
    0
  );
  return roundMoney(sum);
}
