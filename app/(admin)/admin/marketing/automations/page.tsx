import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Zap, ArrowRight } from "lucide-react";

// REG-54: this page previously rendered four hardcoded "automations"
// with invented open rates, conversion rates, an invented average open
// rate and an invented recovered-revenue figure. There is NO automations
// data source in the system — no automations table exists and nothing
// executes lifecycle flows — so the page now states that honestly
// instead of presenting demo numbers as live performance.
export default function MarketingAutomationsPage() {
  return (
    <div className="space-y-8 p-8 pt-6">
      {/* Header */}
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Marketing Automations
          </h1>
          <p className="mt-1 text-muted-foreground">
            Lifecycle triggers, drip sequences, and automatic audience engagement flows.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/admin/marketing/campaigns">Broadcast Campaigns</Link>
        </Button>
      </div>

      {/* KPI Stats — real counts only: there are no automations. */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Active Sequences</CardTitle>
            <Zap className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-muted-foreground mt-1">
              No automated customer journeys are configured
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Honest empty state */}
      <Card>
        <CardHeader>
          <CardTitle>No automations yet</CardTitle>
          <CardDescription className="leading-relaxed">
            Anchor Fashion does not currently run any lifecycle automations —
            there are no welcome sequences, abandoned-checkout recovery flows,
            or win-back campaigns operating, and no performance data exists
            for them. Automated flows are not part of the current system.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground leading-relaxed">
            To reach customers today, send a one-off broadcast from the
            Campaigns area — delivery and failure counts there are computed
            from the real campaign logs.
          </p>
          <Button asChild className="mt-4">
            <Link href="/admin/marketing/campaigns">
              Go to Campaigns <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
