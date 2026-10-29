import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { InvoiceSheet, InvoiceData } from "@/components/print/invoice-sheet";
import { getStoreInfo } from "@/lib/actions/settings.actions";

export const dynamic = "force-dynamic";

/**
 * Public, view-only invoice page (Phase 12).
 *
 * The customer receives this link by SMS (and in the completion email).
 * Access is authorized by the order's unguessable invoice_token
 * (192-bit random, unique per order) — no login is required, and the page
 * intentionally renders ONLY the invoice sheet: no toolbar, no print or
 * download buttons, no site chrome. An unknown token is a branded 404.
 */
export default async function PublicInvoicePage(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;

  if (!token || token.length < 16 || token.length > 64) {
    return notFound();
  }

  const order = await prisma.order
    .findUnique({
      where: { invoiceToken: token },
      include: { items: true },
    })
    .catch(() => null);

  if (!order) {
    return notFound();
  }

  const shippingAddress = (order.shippingAddress || {}) as Record<string, any>;

  const orderDateObj = order.createdAt || new Date();
  const day = String(orderDateObj.getDate()).padStart(2, "0");
  const month = String(orderDateObj.getMonth() + 1).padStart(2, "0");
  const year = orderDateObj.getFullYear();
  const orderDate = `${day}-${month}-${year}`;
  const orderTime = [
    String(orderDateObj.getHours()).padStart(2, "0"),
    String(orderDateObj.getMinutes()).padStart(2, "0"),
    String(orderDateObj.getSeconds()).padStart(2, "0"),
  ].join(":");

  const cleanNumericDigits = (order.id || "").replace(/\D/g, "").slice(0, 10);
  const barcodeValue = `${year.toString().slice(-2)}${month}${day}${cleanNumericDigits.padEnd(10, "0")}`;

  const customerName =
    [shippingAddress.first_name, shippingAddress.last_name]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    shippingAddress.recipient_name ||
    "Valued Customer";
  const customerPhone = shippingAddress.phone || "N/A";

  const formatAddress = (addr: Record<string, any>) => {
    if (!addr) return "";
    const line1 = addr.address_line_1 || addr.street || "";
    const line2 = addr.address_line_2 ? `, ${addr.address_line_2}` : "";
    const city = addr.city ? `, ${addr.city}` : "";
    const zip = addr.zip || addr.postal_code ? ` - ${addr.zip || addr.postal_code}` : "";
    const country = addr.country ? `, ${addr.country}` : ", Bangladesh";
    return `${line1}${line2}${city}${zip}${country}`.replace(/^,\s*/, "");
  };

  const isPaid =
    String(order.paymentStatus || "").toUpperCase() === "PAID" || !!order.paidAt;
  const isCod = String(order.paymentMethod || "").toUpperCase() === "COD" || !isPaid;

  const storeInfo = await getStoreInfo().catch(() => null);

  const invoiceData: InvoiceData = {
    invoiceNumber: order.orderNumber,
    orderNumber: order.orderNumber,
    orderDate,
    orderTime,
    printDate: `${orderDate} ${orderTime}`,
    barcodeValue,
    customer: {
      name: customerName,
      phone: customerPhone,
      email: shippingAddress.email || null,
      address: formatAddress(shippingAddress),
    },
    order: {
      paymentMethod: isCod ? "COD - Cash on Delivery" : order.paymentMethod || "Prepaid",
      paymentStatus: isPaid ? "Paid Online" : "COD Pending",
      isPaid,
      isCod,
      courierName: order.courier || "Standard Courier",
      trackingNumber: order.trackingNumber || null,
      subtotal: Number(order.subtotal || 0),
      shippingTotal: Number(order.shippingFee || 0),
      discountTotal: Number(order.discount || 0),
      taxTotal: Number(order.vatAmount || 0),
      grandTotal: Number(order.totalAmount || 0),
      cashier: "Web",
      branchName: storeInfo?.store_name || "Anchor Fashion",
      branchAddress: storeInfo?.address || "",
    },
    items: (order.items || []).map((it) => ({
      id: it.id,
      product_name: it.productName,
      variant_name: it.variantName,
      sku: it.sku,
      quantity: it.quantity,
      unit_price: Number(it.unitPrice || 0),
      line_total: Number(it.totalPrice || 0),
      total_price: Number(it.totalPrice || 0),
    })),
  };

  return (
    <div className="min-h-screen bg-slate-100 py-4 sm:py-8 text-slate-900 font-sans antialiased">
      {/* View-only: the invoice sheet alone, full-screen. No toolbar,
          no print/download actions, no navigation chrome. */}
      <InvoiceSheet data={invoiceData} />
    </div>
  );
}
