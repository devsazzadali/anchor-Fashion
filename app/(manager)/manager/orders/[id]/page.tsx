import { Metadata } from "next";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  Printer,
  Truck,
  ShieldCheck,
  CreditCard,
  MapPin,
  Eye,
} from "lucide-react";
import Link from "next/link";
import { getOrderDetailsAction } from "@/app/actions/oms/order.actions";
import { notFound } from "next/navigation";
import { OrderStatusUpdater } from "./order-status-updater";
import { getServerSession, resolveUserRole } from "@/lib/auth/server";
import { isSupportRole } from "@/lib/auth/role-label";

export const metadata: Metadata = {
  title: "Order Details | Manager Dashboard",
};

export default async function OrderDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getOrderDetailsAction(id);

  if (!result.success || !result.data) {
    notFound();
  }

  const order = result.data as any;
  const items = order.items || [];

  // REG-33: SUPPORT is read-only in the manager area — the mutation
  // controls are not rendered for support accounts (and the actions
  // themselves reject support sessions server-side).
  const { user } = await getServerSession();
  const viewerRole = user
    ? (user as any).role || (await resolveUserRole(user as any))
    : "";
  const readOnly = isSupportRole(viewerRole);

  // REG-32: the payload already resolves the customer (customer_profiles
  // → profiles → CRM tier → auth email), the shipping/billing addresses,
  // and the shipment — the page previously rendered none of it and
  // showed a raw customer id plus a developer note instead.
  const customer = order.customer || null;
  const shipping = order.shippingAddress || null;
  const shipment = order.shipment || null;

  const formatAddress = (addr: any) => {
    if (!addr) return null;
    const parts = [
      addr.address_line_1 || addr.street || addr.address,
      addr.address_line_2,
      addr.city,
      addr.state,
      addr.zip || addr.postal_code,
      addr.country,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : null;
  };
  const shippingAddressText = formatAddress(shipping);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" asChild>
            <Link href="/manager/orders">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Order {order.order_number}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>Placed on {new Date(order.created_at).toLocaleString()}</span>
              <span>•</span>
              <Badge variant="secondary" className="uppercase">{order.status}</Badge>
              {order.risk_level && (
                <>
                  <span>•</span>
                  <Badge
                    variant="outline"
                    className={
                      order.risk_level === "HIGH"
                        ? "bg-red-500/10 text-red-700 border-red-200"
                        : order.risk_level === "MEDIUM"
                        ? "bg-amber-500/10 text-amber-700 border-amber-200"
                        : "bg-emerald-500/10 text-emerald-700 border-emerald-200"
                    }
                  >
                    COD Risk: {order.risk_level}
                  </Badge>
                </>
              )}
              {order.verification_status && (
                <Badge variant="secondary" className="text-[10px] uppercase font-mono">
                  {order.verification_status}
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {readOnly ? (
            <Badge variant="outline" className="gap-1.5 py-1.5">
              <Eye className="h-3.5 w-3.5" />
              Read-only — Support view
            </Badge>
          ) : (
            <>
              <Button variant="outline" asChild>
                <Link href={`/admin/orders/${order.id}/invoice`} target="_blank">
                  <Printer className="mr-2 h-4 w-4" />
                  Print Invoice
                </Link>
              </Button>
              <Button asChild>
                <Link href="/manager/orders/fulfillment">
                  <Truck className="mr-2 h-4 w-4" />
                  Fulfill Order
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="col-span-1 flex flex-col gap-6 md:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Order Items</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {items.length === 0 ? (
                  <p className="text-muted-foreground">No items in this order.</p>
                ) : (
                  items.map((item: any, idx: number) => (
                    <div key={idx}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="flex h-16 w-16 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
                            Img
                          </div>
                          <div>
                            <p className="font-medium">{item.product_name}</p>
                            <p className="text-sm text-muted-foreground">
                              {item.variant_name || item.sku}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-medium">৳{item.unit_price}</p>
                          <p className="text-sm text-muted-foreground">Qty: {item.quantity}</p>
                        </div>
                      </div>
                      {idx < items.length - 1 && <Separator className="my-4" />}
                    </div>
                  ))
                )}
                
                <Separator className="mt-4" />
                <div className="flex items-center justify-between pt-2 font-medium">
                  <span>Subtotal</span>
                  <span>৳{order.subtotal}</span>
                </div>
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Shipping</span>
                  <span>৳{order.shipping_total}</span>
                </div>
                {order.discount_total > 0 && (
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Discount</span>
                    <span>-৳{order.discount_total}</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Tax</span>
                  <span>৳{order.tax_total}</span>
                </div>
                <Separator className="my-2" />
                <div className="flex items-center justify-between pt-2 text-lg font-bold">
                  <span>Total</span>
                  <span>৳{order.grand_total}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Order Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {order.status === "delivered" && (
                  <div className="flex gap-4">
                    <div className="mt-2 h-2 w-2 rounded-full bg-primary"></div>
                    <div>
                      <p className="font-medium">Delivered</p>
                      <p className="text-sm text-muted-foreground">
                        {order.updated_at ? new Date(order.updated_at).toLocaleString() : ""}
                      </p>
                    </div>
                  </div>
                )}
                {order.status !== "draft" && (
                  <div className="flex gap-4">
                    <div className="mt-2 h-2 w-2 rounded-full bg-primary"></div>
                    <div>
                      <p className="font-medium">Order Placed</p>
                      <p className="text-sm text-muted-foreground">
                        {new Date(order.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="col-span-1 flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Customer Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {customer ? (
                <>
                  <div>
                    <p className="font-semibold">{customer.full_name}</p>
                    {customer.tier && (
                      <p className="text-xs text-muted-foreground">
                        {customer.tier} customer
                      </p>
                    )}
                  </div>
                  {customer.phone && (
                    <div>
                      <p className="text-xs text-muted-foreground">Phone</p>
                      <p>{customer.phone}</p>
                    </div>
                  )}
                  {customer.email && (
                    <div>
                      <p className="text-xs text-muted-foreground">Email</p>
                      <p className="break-all">{customer.email}</p>
                    </div>
                  )}
                </>
              ) : shipping ? (
                <div>
                  <p className="font-semibold">
                    {shipping.recipient_name || "Guest customer"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Guest checkout — no registered account
                  </p>
                  {shipping.phone && (
                    <div className="mt-2">
                      <p className="text-xs text-muted-foreground">Phone</p>
                      <p>{shipping.phone}</p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground">
                  No customer information recorded for this order.
                </p>
              )}
              {shippingAddressText && (
                <div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> Shipping Address
                  </p>
                  <p className="leading-relaxed">{shippingAddressText}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Payment (mirrors the admin detail's REG-19 card) */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                <CreditCard className="h-4 w-4 text-muted-foreground" />
                Payment
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Method</span>
                <span className="font-semibold">
                  {(order.payment_method || "COD").replace(/_/g, " ")}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status</span>
                {(order.payment_status || "").toUpperCase() === "PAID" ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    Paid
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 capitalize">
                    {(order.payment_status || "UNPAID").toLowerCase().replace(/_/g, " ")}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-semibold">
                  ৳{Number(order.grand_total || 0).toLocaleString()}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Shipment (mirrors the admin detail's REG-17 card) */}
          {shipment && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                  <Truck className="h-4 w-4 text-muted-foreground" />
                  Shipment
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Shipment #</span>
                  <span className="font-semibold">
                    {shipment.shipment_number || "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <span className="font-semibold capitalize">
                    {(shipment.status || "").replace(/_/g, " ")}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Courier</span>
                  <span>
                    {shipment.courier_provider_code ||
                      shipment.courier ||
                      "Not assigned yet"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Tracking #</span>
                  <span className="font-mono">
                    {shipment.tracking_number || "—"}
                  </span>
                </div>
                {shipment.is_cod && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">COD Amount</span>
                    <span className="font-semibold">
                      ৳{Number(shipment.cod_amount || 0).toLocaleString()}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-amber-500" />
                  COD Fraud Shield
                </span>
                <Badge
                  className={
                    order.risk_level === "HIGH"
                      ? "bg-red-500/10 text-red-700 border-red-200"
                      : order.risk_level === "MEDIUM"
                      ? "bg-amber-500/10 text-amber-700 border-amber-200"
                      : "bg-emerald-500/10 text-emerald-700 border-emerald-200"
                  }
                  variant="outline"
                >
                  {order.risk_level || "LOW"}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between text-xs py-1 border-b">
                <span className="text-muted-foreground">Risk Score:</span>
                <span className="font-mono font-semibold">{order.risk_score ?? 0} / 100</span>
              </div>
              <div className="flex items-center justify-between text-xs py-1 border-b">
                <span className="text-muted-foreground">Verification:</span>
                <Badge variant="secondary" className="text-[10px] uppercase font-mono">
                  {order.verification_status || "UNVERIFIED"}
                </Badge>
              </div>
              {Array.isArray(order.risk_reasons) && order.risk_reasons.length > 0 && (
                <div className="pt-2">
                  <p className="text-xs font-semibold text-muted-foreground mb-1">
                    Risk Signals:
                  </p>
                  <ul className="space-y-1">
                    {order.risk_reasons.map((reason: string, idx: number) => (
                      <li
                        key={idx}
                        className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1 flex items-start gap-1"
                      >
                        <span className="text-primary font-bold">•</span>
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          {/* REG-33: no status mutation controls for SUPPORT. */}
          {!readOnly && (
            <Card>
              <CardHeader>
                <CardTitle>Update Status</CardTitle>
              </CardHeader>
              <CardContent>
                <OrderStatusUpdater orderId={order.id} currentStatus={order.status} />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
