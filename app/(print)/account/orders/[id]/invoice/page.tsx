import { notFound, redirect } from "next/navigation";
import { createDbClient, createAdminDbClient } from "@/lib/db/client";
import { InvoiceToolbar } from "@/components/print/invoice-toolbar";
import { InvoiceSheet, InvoiceData } from "@/components/print/invoice-sheet";
import { getStoreInfo, getInvoiceInfo } from "@/lib/actions/settings.actions";
import { dhakaDateParts, formatDhakaDate, formatDhakaTime } from "@/lib/utils/datetime";

export default async function CustomerPrintInvoicePage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const db = await createDbClient();
  const { data: { user } } = await db.auth.getUser();

  if (!user) {
    redirect("/auth/login?next=/account/orders");
  }

  const adminDb = await createAdminDbClient();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.id);

  let orderQuery = adminDb
    .from("orders")
    .select(
      `
      *,
      order_items(*),
      order_status_history(*)
    `
    );

  if (isUuid) {
    orderQuery = orderQuery.eq("id", params.id);
  } else {
    orderQuery = orderQuery.eq("order_number", params.id);
  }

  const { data: order, error } = await orderQuery.maybeSingle();

  if (error || !order) {
    return notFound();
  }

  // There is no order_addresses table in this schema — the delivery address
  // is stored as JSON on the order itself (orders.shipping_address).
  const shippingAddress = (order as any).shipping_address || null;

  // Fetch customer profile if customer_id is present
  let customer: any = null;
  if (order.customer_id) {
    try {
      const { data: cProfile } = await adminDb
        .from("customer_profiles")
        .select("first_name, last_name, email, phone")
        .eq("id", order.customer_id)
        .maybeSingle();
      const { data: pProfile } = await adminDb
        .from("profiles")
        .select("first_name, last_name, phone")
        .eq("id", order.customer_id)
        .maybeSingle();
      const fn = cProfile?.first_name || pProfile?.first_name || "";
      const ln = cProfile?.last_name || pProfile?.last_name || "";
      const full = [fn, ln].filter(Boolean).join(" ");
      customer = {
        full_name: full || null,
        first_name: fn,
        last_name: ln,
        phone: cProfile?.phone || pProfile?.phone || null,
        email: cProfile?.email || null,
      };
    } catch {
      // ignore
    }
  }

  // REG-85: Authorization — the order's owner, or staff whose role is
  // resolved from the profiles table. This mirrors the account order-detail
  // page exactly. The previous check trusted user_metadata/app_metadata
  // role claims (self-declared — any signed-in user could claim "ADMIN")
  // and treated an email-address match as ownership (anyone who registered
  // with the email typed at guest checkout could pull the full invoice —
  // name, phone and address — of an order that was never linked to them).
  // Neither is proof of anything; both paths are removed.
  const isOwner =
    order.customer_id === user.id || order.profile_id === user.id;
  if (!isOwner) {
    const { data: profile } = await adminDb
      .from("profiles")
      .select("roles(name)")
      .eq("id", user.id)
      .maybeSingle();
    const roleName = String(
      Array.isArray(profile?.roles)
        ? profile?.roles[0]?.name
        : (profile?.roles as any)?.name || ""
    ).toUpperCase();
    const isStaff = ["SUPERADMIN", "ADMIN", "MANAGER", "STAFF", "SUPPORT"].includes(roleName);
    if (!isStaff) {
      return notFound();
    }
  }

  // Fetch courier shipments if available
  let activeShipment: any = null;
  try {
    const { data: shipments } = await adminDb
      .from("shipments")
      .select("*")
      .eq("order_id", order.id)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(1);
    activeShipment = shipments?.[0] || null;
    // REG-83: shipments has no courier_provider_id FK and courier_providers
    // has no logo_url column, so the old embedded select could never
    // attach. The provider is keyed by CODE (shipments.courier_provider_code)
    // — resolve it with an explicit bound query and attach the same shape.
    if (activeShipment?.courier_provider_code) {
      const { data: provider } = await adminDb
        .from("courier_providers")
        .select("name")
        .eq("code", activeShipment.courier_provider_code)
        .maybeSingle();
      if (provider) {
        activeShipment = {
          ...activeShipment,
          courier_providers: { name: provider.name },
        };
      }
    }
  } catch {
    // Non-critical, fallback to standard shipping
  }

  const items = (order.order_items && order.order_items.length > 0)
    ? order.order_items
    : (order.items || []);

  const invoiceNumber = order.invoice_number || (order.order_number ? order.order_number.replace(/^ORD-/, "INV-") : "INV-ONLINE");
  const orderNumber = order.order_number || order.id?.slice(0, 8).toUpperCase() || "ORD-0000";

  // S5-6: Asia/Dhaka rendering (see the admin invoice page).
  const orderDateObj = new Date(order.created_at || Date.now());
  const { day, month, year } = dhakaDateParts(orderDateObj);
  const orderDate = formatDhakaDate(orderDateObj);
  const orderTime = formatDhakaTime(orderDateObj);

  const cleanNumericDigits = (order.id || "").replace(/\D/g, "").slice(0, 10);
  const barcodeValue = `${year.toString().slice(-2)}${month}${day}${cleanNumericDigits.padEnd(10, "0")}`;

  const printDate = `${day}-${month}-${year} ${orderTime}`;

  const addressFullName = shippingAddress
    ? [shippingAddress.first_name, shippingAddress.last_name].filter(Boolean).join(" ")
    : "";

  const customerName =
    customer?.full_name ||
    order.customer?.full_name ||
    addressFullName ||
    shippingAddress?.recipient_name ||
    (customer?.first_name ? `${customer.first_name} ${customer.last_name || ""}`.trim() : "") ||
    "Valued Customer";

  const customerPhone =
    shippingAddress?.phone ||
    customer?.phone ||
    order.customer?.phone ||
    "N/A";

  const customerEmail =
    customer?.email ||
    order.customer?.email ||
    shippingAddress?.email ||
    "N/A";

  const recipientName = addressFullName || shippingAddress?.recipient_name || customerName;
  const recipientPhone = shippingAddress?.phone || customerPhone;

  const formatAddress = (addr: any) => {
    if (!addr) return "";
    const line1 = addr.address_line_1 || addr.street || "";
    const line2 = addr.address_line_2 ? `, ${addr.address_line_2}` : "";
    const city = addr.city ? `, ${addr.city}` : "";
    const zip = addr.zip || addr.postal_code ? ` - ${addr.zip || addr.postal_code}` : "";
    const country = addr.country ? `, ${addr.country}` : ", Bangladesh";
    const full = `${line1}${line2}${city}${zip}${country}`.replace(/^,\s*/, "");
    return full;
  };

  const deliveryAddress = formatAddress(shippingAddress);

  const statusLower = (order.status || "").toLowerCase();
  const paymentStatusLower = (order.payment_status || "").toLowerCase();
  const isPaid = paymentStatusLower === "paid" || statusLower === "paid" || !!order.paid_at;
  const isCod = (order.payment_method || "").toUpperCase() === "COD" || !isPaid;

  const subtotal = Number(order.subtotal ?? items.reduce((acc: number, it: any) => acc + (Number(it.line_total ?? it.total_price ?? (Number(it.unit_price) * Number(it.quantity)))), 0));
  const grandTotal = Number(order.grand_total ?? order.total_amount ?? subtotal);

  const courierName = activeShipment?.courier_providers?.name || activeShipment?.courier_provider_code || "Standard Courier";
  const trackingNumber = activeShipment?.tracking_number || null;

  // Branch identity comes from the store's configured settings — the page
  // previously printed a hardcoded person's name ("Shojol Mia") and a
  // hardcoded Rangpur address on every customer invoice.
  const storeInfo = await getStoreInfo().catch(() => null);
  const invoiceInfo = await getInvoiceInfo().catch(() => null);

  const invoiceData: InvoiceData = {
    invoiceNumber,
    orderNumber,
    orderDate,
    orderTime,
    printDate,
    barcodeValue,
    company: invoiceInfo || undefined,
    customer: {
      name: recipientName,
      phone: recipientPhone,
      email: customerEmail,
      address: deliveryAddress,
    },
    order: {
      paymentMethod: order.payment_intent_id ? "MFS - Online Payment" : isCod ? "COD - Cash on Delivery" : (order.payment_method || "Prepaid"),
      paymentStatus: isPaid ? "Paid Online" : "COD Pending",
      isPaid,
      isCod,
      courierName,
      trackingNumber,
      subtotal,
      shippingTotal: Number(order.shipping_fee || 0),
      discountTotal: Number(order.discount || 0),
      taxTotal: Number(order.vat_amount ?? order.tax_total ?? 0),
      grandTotal,
      cashier: "Web",
      branchName: storeInfo?.store_name || "Anchor Fashion",
      branchAddress: storeInfo?.address || "",
    },
    items: items.map((it: any) => ({
      id: it.id,
      product_name: it.product_name,
      variant_name: it.variant_name,
      sku: it.sku,
      quantity: it.quantity,
      unit_price: it.unit_price,
      line_total: it.line_total,
      total_price: it.total_price,
    })),
  };

  return (
    <div className="min-h-screen bg-slate-100 py-4 sm:py-8 print:py-0 print:bg-white text-slate-900 font-sans antialiased">
      {/* Screen Toolbar — view-only for customers: no print/download */}
      <InvoiceToolbar
        backUrl={`/account/orders/${order.id}`}
        backLabel="Back to Order Details"
        allowPrint={false}
      />

      {/* Printable Sheet */}
      <InvoiceSheet data={invoiceData} />
    </div>
  );
}
