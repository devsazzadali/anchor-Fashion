import { prisma } from "@/lib/prisma";
import { LoyaltyTier } from "@/features/crm/components/LoyaltyTiers";
import { CustomerLifecycleStage } from "@/features/crm/components/CustomersList";

const DAY_MS = 24 * 60 * 60 * 1000;

interface MergedCustomer {
  id: string; // profile id when a profile exists, else the customers-row id
  altId?: string; // the other id (customers-row id / profile id) for cross-lookups
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  avatarUrl?: string | null;
  createdAt: Date;
  updatedAt: Date;
  storedTotalSpent: number;
}

export class CustomerRepository {
  /**
   * The customer directory's source of truth is the UNION of:
   *  - registered accounts: profiles whose role is CUSTOMER, and
   *  - rows in the `customers` table (created lazily on profile visit or at
   *    checkout for guests).
   * Reading only `customers` hid every registered customer who had not yet
   * visited their profile page — the directory showed "No customers found"
   * while real customers existed.
   */
  private async loadMergedCustomers(): Promise<MergedCustomer[]> {
    const [profiles, customers] = await Promise.all([
      prisma.profile.findMany({
        where: { role: { name: { equals: "CUSTOMER", mode: "insensitive" } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.customer.findMany({ orderBy: { createdAt: "desc" } }),
    ]);

    const byKey = new Map<string, MergedCustomer>();
    const keyFor = (email?: string | null, id?: string | null) =>
      (email || "").toLowerCase() || id || "";

    for (const c of customers) {
      const nameParts = (c.name || "").split(" ");
      byKey.set(keyFor(c.email, c.id), {
        id: c.profileId || c.id,
        altId: c.profileId && c.profileId !== c.id ? c.id : undefined,
        firstName: nameParts[0] || "Customer",
        lastName: nameParts.slice(1).join(" ") || "",
        email: c.email,
        phone: c.phone || "",
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        storedTotalSpent: Number(c.totalSpent) || 0,
      });
    }

    for (const p of profiles) {
      const key = keyFor(p.email, p.id);
      const existing = byKey.get(key);
      if (existing) {
        existing.id = p.id;
        existing.firstName = p.firstName || existing.firstName;
        existing.lastName = p.lastName || existing.lastName;
        existing.phone = p.phone || existing.phone;
        existing.avatarUrl = p.avatarUrl;
        existing.createdAt =
          p.createdAt < existing.createdAt ? p.createdAt : existing.createdAt;
        existing.updatedAt =
          p.updatedAt > existing.updatedAt ? p.updatedAt : existing.updatedAt;
      } else {
        byKey.set(key, {
          id: p.id,
          firstName: p.firstName || "Customer",
          lastName: p.lastName || "",
          email: p.email || "",
          phone: p.phone || "",
          avatarUrl: p.avatarUrl,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          storedTotalSpent: 0,
        });
      }
    }

    return [...byKey.values()].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  }

  /** Real per-customer aggregates from orders + support tickets. */
  private async aggregatesFor(c: MergedCustomer) {
    const ids = [c.id, c.altId].filter(Boolean) as string[];
    const [orders, tickets] = await Promise.all([
      prisma.order.findMany({
        where: {
          OR: [{ profileId: { in: ids } }, { customerId: { in: ids } }],
        },
        select: { totalAmount: true, status: true, createdAt: true },
      }),
      prisma.supportTicket.count({
        where: { customerId: { in: ids } },
      }),
    ]);

    const live = orders.filter(
      (o) => String(o.status).toUpperCase() !== "CANCELLED"
    );
    const ordersCount = live.length;
    const orderSpent = live.reduce(
      (sum, o) => sum + (Number(o.totalAmount) || 0),
      0
    );
    const totalSpent = Math.max(orderSpent, c.storedTotalSpent);
    const lastOrderAt = live.length
      ? new Date(Math.max(...live.map((o) => o.createdAt.getTime())))
      : null;

    return { ordersCount, totalSpent, tickets, lastOrderAt };
  }

  /** Lifecycle stage derived from the customer's real order history. */
  private deriveStage(
    ordersCount: number,
    totalSpent: number,
    lastOrderAt: Date | null
  ): CustomerLifecycleStage {
    if (ordersCount === 0 || !lastOrderAt) return "PROSPECT";
    const idleDays = (Date.now() - lastOrderAt.getTime()) / DAY_MS;
    if (idleDays > 180) return "CHURNED";
    if (idleDays > 90) return "AT_RISK";
    if (ordersCount >= 5 || totalSpent >= 20000) return "LOYAL";
    if (ordersCount >= 2) return "REPEAT_CUSTOMER";
    return "FIRST_TIME_BUYER";
  }

  /**
   * Transparent engagement heuristic computed from the customer's own real
   * signals (orders, recency, open support load, profile completeness) —
   * never from an id hash.
   */
  private deriveHealthScore(
    ordersCount: number,
    lastOrderAt: Date | null,
    openTickets: number,
    phone: string
  ): number {
    let score = 50;
    if (ordersCount >= 1) score += 20;
    if (ordersCount >= 3) score += 10;
    if (lastOrderAt && Date.now() - lastOrderAt.getTime() <= 30 * DAY_MS)
      score += 10;
    if (phone) score += 10;
    if (openTickets > 0) score -= 10;
    return Math.max(5, Math.min(99, score));
  }

  async getCustomerProfiles(limit = 10, search?: string) {
    let merged = await this.loadMergedCustomers();
    if (search) {
      const q = search.toLowerCase();
      merged = merged.filter(
        (c) =>
          c.email.toLowerCase().includes(q) ||
          `${c.firstName} ${c.lastName}`.toLowerCase().includes(q)
      );
    }

    const rows = await Promise.all(
      merged.slice(0, limit).map(async (c) => {
        const agg = await this.aggregatesFor(c);
        const lastInteraction = new Date(
          Math.max(
            c.updatedAt.getTime(),
            agg.lastOrderAt ? agg.lastOrderAt.getTime() : 0
          )
        );
        return {
          id: c.id,
          first_name: c.firstName,
          last_name: c.lastName,
          email: c.email || "N/A",
          phone: c.phone || "",
          assigned_password: null,
          is_vip: agg.totalSpent > 5000,
          customer_lifecycle_stage: this.deriveStage(
            agg.ordersCount,
            agg.totalSpent,
            agg.lastOrderAt
          ),
          health_score: this.deriveHealthScore(
            agg.ordersCount,
            agg.lastOrderAt,
            agg.tickets,
            c.phone
          ),
          total_support_tickets: agg.tickets,
          last_interaction_at: lastInteraction.toISOString(),
        };
      })
    );
    return rows;
  }

  async getCustomerSegments() {
    const stages: CustomerLifecycleStage[] = [
      "PROSPECT",
      "FIRST_TIME_BUYER",
      "REPEAT_CUSTOMER",
      "LOYAL",
      "AT_RISK",
      "CHURNED",
    ];

    // Count customers per stage using the same honest derivation as the
    // directory (previously: fixed fractions of the customer count).
    const merged = await this.loadMergedCustomers();
    const counts: Record<string, number> = Object.fromEntries(
      stages.map((s) => [s, 0])
    );
    await Promise.all(
      merged.map(async (c) => {
        const agg = await this.aggregatesFor(c);
        counts[
          this.deriveStage(agg.ordersCount, agg.totalSpent, agg.lastOrderAt)
        ] += 1;
      })
    );

    const totalCustomers = merged.length;
    return stages.map((stage) => {
      const count = counts[stage] || 0;
      return {
        stage,
        count,
        percentage: totalCustomers > 0 ? Math.round((count / totalCustomers) * 100) : 0,
        trend: "stable" as const,
      };
    });
  }

  async getLoyaltyStats() {
    // Real tier membership from loyalty_accounts (previously: fixed
    // fractions of the customer count).
    const accounts = await prisma.loyalty_accounts.findMany({
      select: { tier: true },
    });
    const countFor = (tier: string) =>
      accounts.filter(
        (a) => String(a.tier || "SILVER").toUpperCase() === tier
      ).length;

    return [
      {
        tier: "SILVER" as LoyaltyTier,
        benefits: ["Basic support", "5% discount on birthdays"],
        customerCount: countFor("SILVER"),
        minPoints: 0,
        color: "bg-slate-300",
      },
      {
        tier: "GOLD" as LoyaltyTier,
        benefits: ["Priority support", "Free shipping", "10% discount on birthdays"],
        customerCount: countFor("GOLD"),
        minPoints: 1000,
        color: "bg-yellow-400",
      },
      {
        tier: "PLATINUM" as LoyaltyTier,
        benefits: ["Dedicated manager", "Free express shipping", "Early access to sales"],
        customerCount: countFor("PLATINUM"),
        minPoints: 5000,
        color: "bg-slate-800 text-white",
      },
      {
        tier: "VIP" as LoyaltyTier,
        benefits: ["All Platinum benefits", "Exclusive event invites", "Personal stylist"],
        customerCount: countFor("VIP"),
        minPoints: 20000,
        color: "bg-purple-900 text-white",
      },
    ];
  }

  async getCRMSummary() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * DAY_MS);

    const merged = await this.loadMergedCustomers();
    const totalCustomers = merged.length;
    const newCustomers = merged.filter(
      (c) => c.createdAt >= thirtyDaysAgo
    ).length;

    // Lifetime value is computed from orders actually linked to these
    // customers (previously: all orders incl. cancelled/guests, and a
    // fabricated 30% loyalty-membership figure).
    let linkedRevenue = 0;
    await Promise.all(
      merged.map(async (c) => {
        const agg = await this.aggregatesFor(c);
        linkedRevenue += agg.totalSpent;
      })
    );
    const loyaltyMembers = await prisma.loyalty_accounts.count();

    return {
      totalCustomers,
      newCustomers,
      avgLifetimeValue: totalCustomers > 0 ? Math.round(linkedRevenue / totalCustomers) : 0,
      loyaltyMembers,
    };
  }

  async getProfile(id: string) {
    const customer = await prisma.customer.findUnique({
      where: { id },
      include: { profile: true },
    });

    if (customer) {
      return {
        id: customer.id,
        first_name: customer.profile?.firstName || customer.name.split(" ")[0] || "Customer",
        last_name: customer.profile?.lastName || customer.name.split(" ")[1] || "",
        email: customer.email,
        // Phone-first identity lives on the profile (guest auto-profiles
        // have no customers-table phone).
        phone: customer.phone || customer.profile?.phone || null,
        avatar_url: customer.profile?.avatarUrl,
        created_at: customer.createdAt.toISOString(),
      };
    }

    // Registered customers may not have a `customers` row yet — fall back
    // to their profile so the detail page works for every directory row.
    const profile = await prisma.profile.findUnique({ where: { id } });
    if (!profile) return null;
    return {
      id: profile.id,
      first_name: profile.firstName || "Customer",
      last_name: profile.lastName || "",
      email: profile.email,
      phone: profile.phone,
      avatar_url: profile.avatarUrl,
      created_at: profile.createdAt.toISOString(),
    };
  }

  async getTickets(id: string) {
    return await prisma.supportTicket.findMany({
      where: { customerId: id },
    });
  }

  async getLoginHistory(id: string) {
    return [];
  }

  /** Resolve every id a customer's orders/tickets may be filed under. */
  private async linkedIds(id: string): Promise<string[]> {
    const ids = new Set<string>([id]);
    const customer = await prisma.customer.findFirst({
      where: { OR: [{ id }, { profileId: id }] },
      select: { id: true, profileId: true },
    });
    if (customer) {
      ids.add(customer.id);
      if (customer.profileId) ids.add(customer.profileId);
    }
    return [...ids];
  }

  async getCustomerOrderStats(id: string) {
    const ids = await this.linkedIds(id);
    const orders = await prisma.order.findMany({
      where: {
        OR: [{ customerId: { in: ids } }, { profileId: { in: ids } }],
        NOT: { status: { equals: "CANCELLED", mode: "insensitive" } },
      },
      select: { totalAmount: true },
    });

    const totalOrders = orders.length;
    const ltv = orders.reduce((sum, order) => sum + (Number(order.totalAmount) || 0), 0);
    return { totalOrders, ltv };
  }

  async getCustomerPoints(id: string) {
    const ids = await this.linkedIds(id);
    const account = await prisma.loyalty_accounts.findFirst({
      where: { customer_id: { in: ids } },
    });
    if (!account) return { points: 0, tier: "Silver" };
    const rawTier = String(account.tier || "SILVER").toLowerCase();
    return {
      points: account.points_balance || 0,
      tier: rawTier.charAt(0).toUpperCase() + rawTier.slice(1),
    };
  }
}
