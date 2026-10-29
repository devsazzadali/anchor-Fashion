"use client";


import { ClientBarcode } from "@/components/ui/ClientBarcode";
import { ClientQRCode } from "@/components/ui/ClientQRCode";

export interface InvoiceItem {
  id?: string;
  product_name: string;
  variant_name?: string | null;
  sku?: string | null;
  quantity: number | string;
  unit_price: number | string;
  line_total?: number | string;
  total_price?: number | string;
}

/** Company identity printed on the invoice — DB-backed (Settings → Invoice & Company). */
export interface InvoiceCompanyInfo {
  company_name: string;
  central_bin: string;
  central_address: string;
  web_address: string;
  customer_care: string;
  shop_concern: string;
  email: string;
  system_by: string;
}

/** Fallbacks identical to the values printed before settings existed. */
export const DEFAULT_INVOICE_COMPANY: InvoiceCompanyInfo = {
  company_name: "Anchor Fashion Ltd",
  central_bin: "001168309-0101",
  central_address: "Plot No# 01, Section #07, Mirpur - 1216, Dhaka",
  web_address: "anchorfashion.com",
  customer_care: "+8801885598889",
  shop_concern: "+8801885813370",
  email: "info@anchorfashion.com",
  system_by: "Anchor Fashion Ltd.",
};

/** The store's live public website — the invoice QR points here. */
export const STORE_WEBSITE_URL = "https://www.anchorfashion.com.bd/";

export interface InvoiceData {
  invoiceNumber: string;
  orderNumber: string;
  orderDate: string;
  orderTime?: string;
  printDate?: string;
  barcodeValue?: string;
  qrCodeUrl?: string;
  company?: Partial<InvoiceCompanyInfo>;
  customer: {
    name: string;
    phone: string;
    email?: string | null;
    address: string;
  };
  order: {
    paymentMethod: string;
    paymentStatus: string;
    isPaid: boolean;
    isCod: boolean;
    courierName: string;
    trackingNumber?: string | null;
    subtotal: number;
    shippingTotal: number;
    discountTotal: number;
    taxTotal?: number;
    grandTotal: number;
    servedBy?: string;
    cashier?: string;
    branchName?: string;
    branchAddress?: string;
  };
  items: InvoiceItem[];
}

export function InvoiceSheet({ data }: { data: InvoiceData }) {
  const {
    invoiceNumber,
    orderNumber,
    orderDate,
    orderTime = "12:00:00",
    customer,
    order,
    items,
    barcodeValue: customBarcode,
    qrCodeUrl: customQrUrl,
    company: companyOverride,
  } = data;

  const company: InvoiceCompanyInfo = {
    ...DEFAULT_INVOICE_COMPANY,
    ...(companyOverride || {}),
  };

  // Compute item counts & amounts
  const totalQuantity = items.reduce(
    (acc, it) => acc + (Number(it.quantity) || 1),
    0
  );

  // Total gross MRP before item or order discounts
  const totalMRP = items.reduce((acc, it) => {
    const qty = Math.max(1, Number(it.quantity) || 1);
    const unitP = Number(it.unit_price) || 0;
    const lineTot = Number(it.line_total ?? it.total_price ?? unitP * qty);
    const effectiveUnit = unitP > 0 ? unitP : (qty > 0 ? lineTot / qty : 0);
    return acc + effectiveUnit * qty;
  }, 0);

  // Line items subtotal (sum of all line totals)
  const lineItemsSubtotal = items.reduce((acc, it) => {
    const qty = Math.max(1, Number(it.quantity) || 1);
    const unitP = Number(it.unit_price) || 0;
    return acc + Number(it.line_total ?? it.total_price ?? unitP * qty);
  }, 0);

  const discountAmount = Math.max(
    0,
    Number(order.discountTotal || 0) > 0
      ? Number(order.discountTotal)
      : Math.round(totalMRP - lineItemsSubtotal)
  );

  const discountPercent =
    totalMRP > 0 ? Math.round((discountAmount / totalMRP) * 100) : 0;

  // Net Amount is the order's stored grand total, shown EXACTLY (2dp) —
  // never rounded to a whole taka: Sub Total + VAT + Delivery Charge −
  // Discount must tie to the order row to the paisa (e.g. 4772.50).
  const netAmount = Number(order.grandTotal ?? order.subtotal ?? lineItemsSubtotal);

  // Delivery charge charged on the order (0 when shipping was free).
  const deliveryCharge = Number(order.shippingTotal || 0);

  // Money display: whole takas print bare (4450, 100), anything with paisa
  // prints at exactly 2dp (222.50, 4772.50) so the summary visibly adds up.
  const fmtMoney = (n: number) => {
    const v = Number((Number(n) || 0).toFixed(2));
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  };

  // VAT actually charged on the order (per-product rates, added on top of the
  // selling price and stored on the order). Never fabricate a percentage of
  // the net amount — an order with no VAT shows 0.
  const vatAmount = fmtMoney(Number(order.taxTotal || 0));

  const paidAmount = order.isPaid ? netAmount : 0;
  const changeAmount = 0;

  // Barcode string: use provided barcode or numeric/order number
  const barcodeToUse =
    customBarcode ||
    orderNumber.replace(/[^A-Za-z0-9]/g, "") ||
    invoiceNumber.replace(/[^A-Za-z0-9]/g, "") ||
    "2608052500467877";

  // QR Code: always points at the store's live public website homepage
  // (owner decision 2026-10-29). It previously encoded the current page URL
  // under a "Download Our App" caption — the store has no app.
  const qrToUse = customQrUrl || STORE_WEBSITE_URL;

  // Payment text matching reference image (e.g. MFS - Bangla QR: 4842 or COD - Cash on Delivery: 4842)
  const paymentMethodLabel = order.isPaid
    ? `${order.paymentMethod || "Online Payment"}: ${fmtMoney(netAmount)}`
    : `COD - Cash on Delivery: ${fmtMoney(netAmount)}`;

  return (
    <div
      className="relative w-full max-w-[480px] mx-auto bg-white border border-gray-300 print:border-none shadow-sm print:shadow-none p-5 sm:p-7 print:p-0 print:max-w-none text-black font-sans text-xs print:text-[11px] leading-tight break-inside-avoid print:break-inside-avoid"
      style={{ pageBreakInside: "avoid" }}
    >
      {/* 1. Top Right: Mushak-6.3 */}
      <div className="text-right font-bold text-xs sm:text-[13px] tracking-wide mb-1 text-black">
        Mushak-6.3
      </div>

      {/* 2. Official Header (Centered) */}
      <div className="text-center space-y-0.5 text-black">
        <p className="text-[10px] sm:text-[11px] text-gray-800">
          Government of the people&apos;s Republic of Bangladesh
        </p>
        <p className="text-[9.5px] sm:text-[10px] text-gray-700">
          National Board of Revenue
        </p>
        <h1 className="text-sm sm:text-base font-bold tracking-tight text-black pt-0.5">
          {company.company_name}
        </h1>
        <p className="text-[9.5px] sm:text-[10px] text-gray-800">
          Central BIN : {company.central_bin}
        </p>
        <p className="text-[9px] sm:text-[9.5px] text-gray-700">
          Central Address : {company.central_address}
        </p>
        <p className="text-[10.5px] font-bold text-black pt-0.5">
          {order.branchName || "Online Store Branch"}
        </p>
        <p className="text-[9px] sm:text-[9.5px] text-gray-700">
          Branch Address : {order.branchAddress || ""}
        </p>
      </div>

      {/* Under Header Divider */}
      <div className="w-full border-t border-black my-2" />

      {/* 3. Order & Customer Info (Left) + Date (Right) */}
      <div className="flex justify-between items-start text-[11px] leading-[1.35] mb-2 text-black">
        <div className="space-y-0.5 pr-2">
          <p className="font-mono font-bold tracking-wider">{barcodeToUse}</p>
          <p>
            <span className="font-normal text-gray-800">Name:</span>{" "}
            <span className="font-semibold">{customer.name}</span>
          </p>
          <p>
            <span className="font-normal text-gray-800">Address:</span>{" "}
            <span>{customer.address}</span>
          </p>
          <p>
            <span className="font-normal text-gray-800">Phone:</span>{" "}
            <span className="font-mono font-medium">{customer.phone}</span>
          </p>
          <p>
            <span className="font-normal text-gray-800">Served by:</span>{" "}
            <span>{order.servedBy || "Online Store"}</span>
          </p>
          <p>
            <span className="font-normal text-gray-800">Time:</span>{" "}
            <span className="font-mono">{orderTime}</span>
          </p>
          <p>
            <span className="font-normal text-gray-800">Cashier:</span>{" "}
            <span>{order.cashier || "Web"}</span>
          </p>
        </div>
        <div className="text-right font-mono text-[11px] text-black shrink-0 font-medium pt-0.5">
          {orderDate}
        </div>
      </div>

      {/* Horizontal Divider */}
      <div className="w-full border-t-2 border-dashed border-black my-2" />

      {/* 4. Items Table */}
      <div className="w-full mb-1">
        <table className="w-full text-left text-[11px] border-collapse text-black">
          <thead>
            <tr className="border-b border-black text-[10px] font-bold">
              <th className="py-1 text-left">Description</th>
              <th className="py-1 text-center w-8">Qty</th>
              <th className="py-1 text-right w-12">MRP</th>
              <th className="py-1 text-right w-10">Dis%</th>
              <th className="py-1 text-right w-14">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {items.map((item, idx) => {
              const qty = Math.max(1, Number(item.quantity) || 1);
              const lineTotal = Number(
                item.line_total ??
                  item.total_price ??
                  Number(item.unit_price) * qty
              );
              const mrp =
                Number(item.unit_price) ||
                (qty > 0 ? Math.round(lineTotal / qty) : 0);
              const originalTotal = mrp * qty;
              const disPercent =
                originalTotal > lineTotal && originalTotal > 0
                  ? Math.round(
                      ((originalTotal - lineTotal) / originalTotal) * 100
                    )
                  : 0;

              // Format clean product description
              const descriptionParts = [
                item.sku ? `${item.sku}` : "",
                item.product_name,
                item.variant_name ? `| ${item.variant_name}` : "",
              ].filter(Boolean);

              const description = descriptionParts.join(" ");

              return (
                <tr key={item.id || idx} className="align-top">
                  <td className="py-1 pr-1.5 leading-tight">
                    <span className="text-[10.5px] font-normal break-words">
                      {description}
                    </span>
                  </td>
                  <td className="py-1 text-center font-mono text-[11px]">{qty}</td>
                  <td className="py-1 text-right font-mono text-[11px]">{mrp}</td>
                  <td className="py-1 text-right font-mono text-[11px]">
                    {disPercent}
                  </td>
                  <td className="py-1 text-right font-mono text-[11px]">
                    {lineTotal}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Sub Total Row */}
        <div className="w-full border-t border-black my-1" />
        <div className="flex justify-between items-center text-[11px] font-bold py-0.5">
          <div className="w-1/2">Sub Total</div>
          <div className="w-8 text-center font-mono">{totalQuantity}</div>
          <div className="flex-1 text-right font-mono">{fmtMoney(lineItemsSubtotal)}</div>
        </div>
      </div>

      {/* Horizontal Divider */}
      <div className="w-full border-t border-dashed border-black my-2" />

      {/* 5. Summary Section (Right Aligned) */}
      <div className="flex justify-end my-2">
        <div className="w-56 sm:w-64 text-[11px] space-y-0.5 text-black">
          <div className="flex justify-between">
            <span>Total Amount:</span>
            <span className="font-mono">{totalMRP}</span>
          </div>
          <div className="flex justify-between">
            <span>Discount:</span>
            <span className="font-mono">{discountAmount}</span>
          </div>
          <div className="flex justify-between">
            <span>Discount(%):</span>
            <span className="font-mono">{discountPercent}</span>
          </div>
          <div className="flex justify-between">
            <span>Bag Discount:</span>
            <span className="font-mono">0</span>
          </div>
          <div className="flex justify-between">
            <span>Delivery Charge:</span>
            <span className="font-mono">{fmtMoney(deliveryCharge)}</span>
          </div>
          <div className="flex justify-between">
            <span>VAT:</span>
            <span className="font-mono">{vatAmount}</span>
          </div>
          <div className="flex justify-between font-bold">
            <span>Net Amount:</span>
            <span className="font-mono font-bold">{fmtMoney(netAmount)}</span>
          </div>
          <div className="flex justify-between">
            <span>Paid Amount:</span>
            <span className="font-mono">{fmtMoney(paidAmount)}</span>
          </div>
          <div className="flex justify-between">
            <span>Change Amount:</span>
            <span className="font-mono">{changeAmount}</span>
          </div>
        </div>
      </div>

      {/* Horizontal Divider */}
      <div className="w-full border-t border-dashed border-black my-2" />

      {/* 6. Payment Info */}
      <div className="text-[11px] my-2 text-black leading-tight">
        <p className="font-semibold mb-0.5">Payment Info:</p>
        <p className="font-mono text-[10.5px]">{paymentMethodLabel}</p>
      </div>

      {/* Horizontal Divider */}
      <div className="w-full border-t border-dashed border-black my-2" />

      {/* 7. Instructions */}
      <div className="text-[9.5px] sm:text-[10px] leading-tight my-2 text-black space-y-0.5">
        <p className="font-semibold">Instructions:</p>
        <p className="text-gray-800 leading-snug">
          We accept the exchange of unworn and unaltered garments within 15 days
          of purchase provided that the original invoice, tags, and packaging are
          carefully preserved. Exchange is allowed only once for a product of an
          invoice.
        </p>
      </div>

      {/* 8. Contact & Approval Details (Centered) */}
      <div className="text-center text-[10px] leading-[1.3] space-y-0.5 my-3 text-black">
        <p>
          <span className="font-semibold">Web Address :</span> {company.web_address}
        </p>
        <p>
          <span className="font-semibold">Customer Care :</span> {company.customer_care}
        </p>
        <p>
          <span className="font-semibold">Shop Concern :</span> {company.shop_concern}
        </p>
        <p>
          <span className="font-semibold">Email :</span> {company.email}
        </p>
        <p className="pt-0.5">
          <span className="font-semibold">System by:</span> {company.system_by}
        </p>
        <p className="font-semibold pt-0.5">
          Approved by: National Board of Revenue
        </p>
        <p className="font-semibold">(NBR)</p>
      </div>

      {/* 9. Barcode (Centered) */}
      <div className="flex flex-col items-center justify-center my-3">
        <ClientBarcode
          value={barcodeToUse}
          format="CODE128"
          width={1.6}
          height={38}
          fontSize={11}
          margin={0}
          displayValue={true}
          background="transparent"
        />
      </div>

      {/* Horizontal Divider */}
      <div className="w-full border-t border-dotted border-black my-3" />

      {/* 10. QR Code (Centered) */}
      <div className="flex flex-col items-center justify-center my-3 space-y-1.5">
        <ClientQRCode value={qrToUse} size={110} level="M" />
        <p className="text-[11px] font-semibold text-black tracking-wide">
          Scan to Visit Our Website
        </p>
      </div>
    </div>
  );
}
