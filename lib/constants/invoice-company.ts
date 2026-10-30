/**
 * REG-82 — the ONE canonical copy of the invoice legal-identity
 * defaults (company name, Central BIN, central address, care lines).
 *
 * Live values come from Admin → Settings → Invoice & Company
 * (the `invoice_info` settings row, read via getInvoiceInfo()). These
 * defaults are only the fallback when settings are unavailable, and
 * they must exist in exactly one place: previously the identical block
 * was duplicated in lib/actions/settings.actions.ts (server defaults)
 * and components/print/invoice-sheet.tsx (print fallback), so editing
 * one silently left the printed Mushak invoice carrying a stale BIN.
 *
 * Dependency-free module: importable from both server actions and the
 * client print component.
 */
export interface InvoiceCompanyDefaults {
  company_name: string;
  central_bin: string;
  central_address: string;
  web_address: string;
  customer_care: string;
  shop_concern: string;
  email: string;
  system_by: string;
}

export const DEFAULT_INVOICE_INFO: InvoiceCompanyDefaults = {
  company_name: "Anchor Fashion Ltd",
  central_bin: "001168309-0101",
  central_address: "Plot No# 01, Section #07, Mirpur - 1216, Dhaka",
  web_address: "anchorfashion.com",
  customer_care: "+8801885598889",
  shop_concern: "+8801885813370",
  email: "info@anchorfashion.com",
  system_by: "Anchor Fashion Ltd.",
};
