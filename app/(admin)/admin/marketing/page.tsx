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
  Mail,
  Smartphone,
  TrendingUp,
  Plus,
  ArrowRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { fetchAdminMarketingStatsAction, fetchDashboardCampaignsAction } from "@/app/actions/manager/marketing.actions";

export const metadata: Metadata = {
  title: "Marketing Automation | Admin Dashboard",
};

export default async function MarketingDashboardPage() {
  const [statsRes, campaignsRes] = await Promise.all([
    fetchAdminMarketingStatsAction(),
    fetchDashboardCampaignsAction(undefined, 5)
  ]);

  // REG-24: revenue / open-rate / CTR cards were removed — they had no
  // real source (the old stats fabricated them). Every figure below is
  // a count from the campaigns / campaign_logs tables.
  const stats = statsRes.data || {
    campaignsTotal: 0,
    campaignsSent: 0,
    campaignsScheduled: 0,
    campaignsDraft: 0,
    messagesSent: 0,
    messagesFailed: 0,
    automations: { total: 0, running: 0, scheduled: 0 },
  };
  const campaigns = campaignsRes.data || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Marketing Automation
          </h1>
          <p className="mt-1 text-muted-foreground">
            Drive growth with targeted campaigns and automated workflows.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/admin/marketing/automations">Manage Automations</Link>
          </Button>
          <Button asChild>
            <Link href="/admin/marketing/campaigns">
              <Plus className="mr-2 h-4 w-4" />
              New Campaign
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Campaigns Sent
            </CardTitle>
            <Mail className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.campaignsSent}</div>
            <p className="mt-1 flex items-center text-xs text-muted-foreground">
              of {stats.campaignsTotal} campaigns created
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Messages Delivered
            </CardTitle>
            <Mail className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.messagesSent}</div>
            <p className="mt-1 flex items-center text-xs text-muted-foreground">
              {stats.messagesFailed} failed deliveries logged
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Scheduled &amp; Drafts
            </CardTitle>
            <Smartphone className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.campaignsScheduled + stats.campaignsDraft}
            </div>
            <p className="mt-1 flex items-center text-xs text-muted-foreground">
              {stats.campaignsScheduled} scheduled, {stats.campaignsDraft} drafts
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Active Automations
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.automations.total}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {stats.automations.running} running, {stats.automations.scheduled} scheduled
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card className="col-span-2">
          <CardHeader>
            <CardTitle>Recent Campaigns</CardTitle>
            <CardDescription>
              Performance of your latest marketing pushes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-8">
              {campaigns.length === 0 ? (
                <div className="text-center text-muted-foreground py-4">No recent campaigns.</div>
              ) : (
                campaigns.map((campaign: any) => (
                  <div key={campaign.id} className="flex items-center">
                    <div className="mr-4 rounded-full bg-primary/10 p-2">
                      {campaign.type === 'push' || campaign.type === 'sms' ? (
                        <Smartphone className="h-4 w-4 text-primary" />
                      ) : (
                        <Mail className="h-4 w-4 text-primary" />
                      )}
                    </div>
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-medium leading-none">
                        {campaign.name}
                      </p>
                      <p className="text-xs text-muted-foreground capitalize">
                        Status: {campaign.status}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold capitalize">{campaign.type}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(campaign.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Automation Triggers</CardTitle>
            {/* FIX ROUND 29 (D9): this card claimed "Always-on revenue
                drivers" and invented efficacy ("Abandoned Cart —
                Recovers ~15% of carts") with play buttons implying the
                flows were live — contradicting the Automations page
                (REG-54): no automations exist or run. The card now
                states the configured state honestly and describes only
                what each trigger WOULD do once set up. */}
            <CardDescription>
              {stats.automations.total > 0
                ? `${stats.automations.running} running of ${stats.automations.total} configured automations.`
                : "Not set up yet — no lifecycle automations are configured, so nothing runs automatically."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[
                {
                  name: "Abandoned Cart",
                  would: "Would message shoppers who leave items in their cart, about an hour after they leave.",
                },
                {
                  name: "Welcome Series",
                  would: "Would greet new signups with an introductory series of messages.",
                },
                {
                  name: "Post-Purchase Review",
                  would: "Would ask buyers for a review after their order is delivered.",
                },
              ].map((trigger) => (
                <div
                  key={trigger.name}
                  className="flex items-center justify-between gap-3 rounded-md border p-2"
                >
                  <div>
                    <p className="text-sm font-medium">{trigger.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {trigger.would}
                    </p>
                  </div>
                  <Badge variant="secondary" className="shrink-0 text-xs">
                    {stats.automations.total > 0 ? "Configured" : "Not configured"}
                  </Badge>
                </div>
              ))}
              <Button variant="ghost" size="sm" asChild className="px-0">
                <Link href="/admin/marketing/automations">
                  Open Automations <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
