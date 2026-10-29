import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sales Dashboard | Anchor Fashion",
  description: "Enterprise Sales Analytics",
};

export default function SalesDashboardPage() {
  // This legacy page previously rendered invented figures (hardcoded sales
  // totals and a "live" order stream with random amounts). Those
  // fabrications were removed in Phase 6; real sales analytics live in the
  // admin dashboard and report builder.
  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Sales Analytics</h2>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-xl border bg-card p-6 text-card-foreground shadow">
          <h3 className="mb-2 text-sm font-medium tracking-tight">
            Today&apos;s Sales
          </h3>
          <div className="text-2xl font-bold">—</div>
          <p className="text-xs text-muted-foreground">No data loaded</p>
        </div>
        <div className="rounded-xl border bg-card p-6 text-card-foreground shadow">
          <h3 className="mb-2 text-sm font-medium tracking-tight">
            Conversion Rate
          </h3>
          <div className="text-2xl font-bold">—</div>
          <p className="text-xs text-muted-foreground">No data loaded</p>
        </div>
        <div className="rounded-xl border bg-card p-6 text-card-foreground shadow">
          <h3 className="mb-2 text-sm font-medium tracking-tight">
            Average Order Value
          </h3>
          <div className="text-2xl font-bold">—</div>
          <p className="text-xs text-muted-foreground">No data loaded</p>
        </div>
      </div>

      <div className="mt-8 rounded-xl border bg-card p-6 text-card-foreground shadow">
        <h3 className="mb-4 text-lg font-semibold">Live Orders Stream</h3>
        <p className="text-sm text-muted-foreground">
          No live orders to show. See the admin orders dashboard for real-time
          order activity.
        </p>
      </div>
    </div>
  );
}
