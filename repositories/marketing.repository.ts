import { createAdminDbClient } from "@/lib/db/client";
import { prisma } from "@/lib/prisma";
import { Campaign, CampaignAudience } from "@/types/marketing.types";

export class MarketingRepository {
  async getCampaigns(): Promise<Campaign[]> {
    const db = createAdminDbClient();
    const { data, error } = await db
      .from("campaigns")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    const campaigns = data || [];
    return (await this.attachAudiences(db, campaigns)) as Campaign[];
  }

  async getCampaignById(id: string): Promise<Campaign | null> {
    const db = createAdminDbClient();
    const { data, error } = await db
      .from("campaigns")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw new Error(error.message);
    }
    if (!data) return null;
    const [withAudiences] = await this.attachAudiences(db, [data]);
    return withAudiences as Campaign;
  }

  /**
   * REG-83: the campaign_audiences(*) embed on campaigns never attaches
   * (unsupported pair), so campaign audiences were always missing. Fetch
   * them explicitly by campaign_id and attach as an array, preserving
   * the shape the embed used to promise.
   */
  private async attachAudiences(
    db: ReturnType<typeof createAdminDbClient>,
    campaigns: Record<string, any>[]
  ): Promise<Record<string, any>[]> {
    if (campaigns.length === 0) return campaigns;
    const ids = campaigns.map((c) => c.id).filter(Boolean);
    const audiencesByCampaign = new Map<string, any[]>();
    if (ids.length > 0) {
      const { data: audiences } = await db
        .from("campaign_audiences")
        .select("*")
        .in("campaign_id", ids);
      for (const a of audiences || []) {
        if (!a?.campaign_id) continue;
        const list = audiencesByCampaign.get(a.campaign_id) || [];
        list.push(a);
        audiencesByCampaign.set(a.campaign_id, list);
      }
    }
    return campaigns.map((c) => ({
      ...c,
      campaign_audiences: audiencesByCampaign.get(c.id) || [],
    }));
  }

  async createCampaign(campaign: Partial<Campaign>): Promise<Campaign> {
    const db = createAdminDbClient();
    let createdBy = campaign.created_by;
    if (!createdBy || createdBy === "00000000-0000-0000-0000-000000000000") {
      const { data: prof } = await db
        .from("profiles")
        .select("id")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      createdBy = prof?.id || "83dded7c-78c7-4f3f-8dd9-e82f8da7f0c0";
    }

    const { data, error } = await db
      .from("campaigns")
      .insert({
        ...campaign,
        created_by: createdBy,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async updateCampaign(
    id: string,
    updates: Partial<Campaign>
  ): Promise<Campaign> {
    const db = createAdminDbClient();
    const { data, error } = await db
      .from("campaigns")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async deleteCampaign(id: string): Promise<boolean> {
    const db = createAdminDbClient();
    const { error } = await db
      .from("campaigns")
      .delete()
      .eq("id", id);

    if (error) throw new Error(error.message);
    return true;
  }

  async getAudiences(): Promise<CampaignAudience[]> {
    const db = createAdminDbClient();
    const { data, error } = await db
      .from("campaign_audiences")
      .select("*")
      .order("name");
    if (error) throw new Error(error.message);
    return data || [];
  }

  async createAudience(
    audience: Partial<CampaignAudience>
  ): Promise<CampaignAudience> {
    const db = createAdminDbClient();
    const { data, error } = await db
      .from("campaign_audiences")
      .insert(audience)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async getManagerMarketingStats() {
    const db = createAdminDbClient();
    
    // We attempt to get counts. If tables don't exist exactly, we fail gracefully.
    // 1. Coupons (Active)
    let activeCoupons = 0;
    try {
      const { count } = await db.from("coupons").select("*", { count: "exact", head: true }).eq("is_active", true);
      activeCoupons = count || 0;
    } catch (e) {
      // ignore
    }

    // 2. Upcoming scheduled campaigns
    let upcomingSales = 0;
    try {
      const { count } = await db.from("campaigns").select("*", { count: "exact", head: true }).eq("status", "scheduled");
      upcomingSales = count || 0;
    } catch (e) {
      // ignore
    }

    // 3. Email Drafts
    let draftEmails = 0;
    try {
      const { count } = await db.from("campaigns").select("*", { count: "exact", head: true }).eq("type", "email").eq("status", "draft");
      draftEmails = count || 0;
    } catch (e) {
      // ignore
    }

    // 4. Push Sent Today
    let pushSentToday = 0;
    try {
      const today = new Date();
      today.setHours(0,0,0,0);
      const { count } = await db.from("campaign_logs").select("*", { count: "exact", head: true }).gte("created_at", today.toISOString());
      pushSentToday = count || 0;
    } catch (e) {
      // ignore
    }

    return {
      activeCoupons,
      upcomingSales,
      draftEmails,
      pushSentToday,
    };
  }

  async getAdminMarketingStats() {
    // REG-24: this previously FABRICATED its headline numbers —
    // revenue was a hardcoded 124592 + 1000 per campaign row (so
    // merely SCHEDULING a campaign "earned" 1000), and open rate /
    // CTR were constants with cosmetic jitter. There is NO real source
    // for any of the three: orders carry no campaign attribution, and
    // no open/click tracking exists anywhere in the system. Those
    // metrics are REMOVED. What remains is computed from the two real
    // sources that exist: the `campaigns` table (status counts) and
    // `campaign_logs` (one row per recipient per send attempt, written
    // by MarketingService.sendCampaign).
    const [
      campaignsTotal,
      campaignsSent,
      campaignsScheduled,
      campaignsDraft,
      runningCount,
      messagesSent,
      messagesFailed,
    ] = await Promise.all([
      prisma.campaigns.count(),
      prisma.campaigns.count({
        where: { status: { in: ["sent", "completed"] } },
      }),
      prisma.campaigns.count({ where: { status: "scheduled" } }),
      prisma.campaigns.count({ where: { status: "draft" } }),
      prisma.campaigns.count({
        where: { status: { in: ["running", "sending"] } },
      }),
      prisma.campaign_logs.count({ where: { status: "sent" } }),
      prisma.campaign_logs.count({ where: { status: "failed" } }),
    ]);

    return {
      campaignsTotal,
      campaignsSent,
      campaignsScheduled,
      campaignsDraft,
      messagesSent,
      messagesFailed,
      automations: {
        total: runningCount + campaignsScheduled,
        running: runningCount,
        scheduled: campaignsScheduled,
      },
    };
  }

  async getDashboardCampaigns(status?: string, limit = 5) {
    const db = createAdminDbClient();
    let query = db.from("campaigns").select("*").order("created_at", { ascending: false }).limit(limit);
    if (status) {
      query = query.eq("status", status);
    }
    const { data, error } = await query;
    if (error) return [];
    return data;
  }
}
