import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AlertCircle, PackageX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { fetchInventoryAction } from "@/app/actions/manager/inventory.actions";

export async function InventoryAlerts() {
  // FIX ROUND 29 (D6): the alert state must come from the SAME full-set
  // counts the manager inventory page shows (getInventoryDashboard's
  // stats cover every inventory level). This widget previously decided
  // "no alerts" from the first 20 levels only — while the inventory
  // page reported Low Stock 32 / Out of Stock 8, the dashboard said
  // "No inventory alerts". The counts now drive both the empty state
  // and the header line; the item list is drawn from a full fetch and
  // ordered out-of-stock first.
  const result = await fetchInventoryAction(1000);
  const stats = result.data?.stats || { totalItems: 0, lowStock: 0, outOfStock: 0 };
  const allItems = result.data?.items || [];

  const alerts = allItems
    .filter(
      (item) => item.status === "Low Stock" || item.status === "Out of Stock"
    )
    .sort((a, b) =>
      a.status === b.status ? a.available - b.available : a.status === "Out of Stock" ? -1 : 1
    )
    .slice(0, 5); // Show top 5 alerts

  if (stats.lowStock + stats.outOfStock === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Inventory Alerts</CardTitle>
          <CardDescription>All products are sufficiently stocked.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            ✅ No inventory alerts at this time.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Inventory Alerts</CardTitle>
        <CardDescription>
          {stats.outOfStock} out of stock · {stats.lowStock} low stock — products requiring immediate restocking.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {alerts.map((item) => {
          const isOut = item.status === "Out of Stock";
          return (
            <div
              key={item.id}
              className="flex items-center justify-between space-x-4"
            >
              <div className="flex items-center space-x-4">
                <div
                  className={`rounded-full p-2 ${isOut ? "bg-destructive/10 text-destructive" : "bg-orange-500/10 text-orange-500"}`}
                >
                  {isOut ? (
                    <PackageX className="h-4 w-4" />
                  ) : (
                    <AlertCircle className="h-4 w-4" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium leading-none">{item.name}</p>
                  <p className="text-sm text-muted-foreground">{item.sku}</p>
                </div>
              </div>
              <div className="text-right">
                <Badge
                  variant={isOut ? "destructive" : "secondary"}
                  className={
                    !isOut ? "bg-orange-500 text-white hover:bg-orange-600" : ""
                  }
                >
                  {item.available} in stock
                </Badge>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
