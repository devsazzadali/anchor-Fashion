import { Metadata } from "next";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Package,
  AlertTriangle,
  ArrowRightLeft,
  TrendingUp,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { OperationsInventoryClient } from "@/features/inventory/components/OperationsInventoryClient";

export const metadata: Metadata = {
  title: "Inventory Management | Anchor Fashion Enterprise",
  description: "Enterprise Inventory and Stock Management Dashboard",
};

export default async function InventoryDashboard() {
  // REG-83: Prisma read, not the fluent builder — the builder never
  // attaches the embedded `variants(...)` / `warehouses(name)` selects
  // on inventory_levels, so every row arrived without its variant and
  // the Inventory Value KPI below computed from a missing price (always
  // ৳0) while the ledger rendered "N/A" SKUs and fallback names. Rows
  // are mapped into the snake_case shape the page and the client table
  // already consume.
  const levels = await prisma.inventoryLevel.findMany({
    orderBy: { quantityAvailable: "asc" },
    select: {
      id: true,
      variantId: true,
      warehouseId: true,
      quantityAvailable: true,
      quantityReserved: true,
      reorderPoint: true,
      createdAt: true,
      updatedAt: true,
      variant: {
        select: {
          sku: true,
          priceOverride: true,
          salePrice: true,
          attributes: true,
          product: { select: { name: true, basePrice: true } },
        },
      },
      warehouse: { select: { name: true } },
    },
  });

  const realInventory = levels.map((level) => ({
    id: level.id,
    variant_id: level.variantId,
    warehouse_id: level.warehouseId,
    quantity_available: level.quantityAvailable,
    quantity_reserved: level.quantityReserved,
    reorder_point: level.reorderPoint,
    created_at: level.createdAt,
    updated_at: level.updatedAt,
    variants: level.variant
      ? {
          sku: level.variant.sku,
          price_override:
            level.variant.priceOverride != null ? Number(level.variant.priceOverride) : null,
          sale_price:
            level.variant.salePrice != null ? Number(level.variant.salePrice) : null,
          attributes: level.variant.attributes,
          products: level.variant.product
            ? {
                name: level.variant.product.name,
                base_price:
                  level.variant.product.basePrice != null
                    ? Number(level.variant.product.basePrice)
                    : null,
              }
            : null,
        }
      : null,
    warehouses: level.warehouse ? { name: level.warehouse.name } : null,
  }));
  
  const totalItems = realInventory.reduce((sum: number, item: any) => sum + (item.quantity_available || 0), 0);
  
  const lowStockCount = realInventory.filter(
    (item: any) => item.quantity_available <= (item.reorder_point || 0)
  ).length;

  const totalIncoming = realInventory.reduce((sum: number, item: any) => sum + (item.quantity_incoming || 0), 0);
  
  // Calculate inventory value using quantity * price (or default to 0 if price is missing)
  const inventoryValue = realInventory.reduce((sum: number, item: any) => {
    const price = (item.variants as any)?.price_override || (item.variants as any)?.products?.base_price || 0;
    return sum + (item.quantity_available || 0) * price;
  }, 0);
  
  // Format value to something readable like 12.4M or 45K
  const formattedValue = inventoryValue > 1000000 
    ? (inventoryValue / 1000000).toFixed(1) + "M"
    : inventoryValue > 1000
    ? (inventoryValue / 1000).toFixed(1) + "K"
    : inventoryValue.toFixed(0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Inventory Management
          </h1>
          <p className="text-muted-foreground">
            Monitor real-time stock levels, valuations, and movements.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/admin/inventory/transfers">
              <ArrowRightLeft className="mr-2 h-4 w-4" /> Transfer Stock
            </Link>
          </Button>
          <Button asChild>
            <Link href="/admin/inventory/purchases">
              <Plus className="mr-2 h-4 w-4" /> Receive Goods
            </Link>
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Items</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalItems.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              Across all warehouses
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Low Stock Alerts
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{lowStockCount}</div>
            <p className="text-xs text-muted-foreground">
              SKUs below reorder point
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Incoming (PO)</CardTitle>
            <TrendingUp className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalIncoming.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Units in transit</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Inventory Value
            </CardTitle>
            <span className="h-4 w-4 font-semibold text-muted-foreground">
              ৳
            </span>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formattedValue}</div>
            <p className="text-xs text-muted-foreground">
              Current valuation (MAC)
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Inventory Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
            <div>
              <CardTitle>Stock Ledger</CardTitle>
              <CardDescription>
                Real-time view of all variants across the enterprise network.
              </CardDescription>
            </div>
            <div className="flex w-full gap-2 md:w-auto">
              <OperationsInventoryClient inventory={realInventory} />
            </div>
          </div>
        </CardHeader>
      </Card>
    </div>
  );
}
