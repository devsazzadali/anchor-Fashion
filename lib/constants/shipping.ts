/**
 * REG-63 — the ONE canonical pair of fallback delivery charges (BDT).
 *
 * Configured delivery zones (Admin → Shipping → Zones) always win:
 * checkout resolves the charge from the zones table via
 * resolveShippingCharge. These constants are only the fallback used
 * when no zone rate applies or a rates lookup fails — and every
 * surface that needs that fallback (order service, checkout, FAQ /
 * support policy defaults, courier price-estimate fallback) reads it
 * from HERE, so the storefront can never quote one pair of charges
 * while the order engine charges another (previously FAQ/support said
 * ৳60/৳120 while checkout fell back to ৳100/৳150).
 */
export const FALLBACK_DELIVERY_FEES = {
  insideDhaka: 100,
  outsideDhaka: 150,
} as const;
