import { prisma } from "@/lib/prisma";

/**
 * Admin read path for newsletter subscribers.
 *
 * Root cause of REG-37: this method was a stub that unconditionally
 * returned [] ("table is not mapped to Prisma schema yet"), so the admin
 * Newsletter page always showed 0 subscribers while the storefront
 * subscribe action was correctly writing rows to `newsletter_subscribers`
 * all along. The table IS mapped (`model newsletter_subscribers` in
 * prisma/schema.prisma) — read it through Prisma like every other
 * repository fixed in the REG-17 line of work, and map rows to the shape
 * the NewsletterClient table renders (status from is_active, subscribed_at
 * from created_at; the table has no name/source columns, so those stay
 * null and the client falls back to its "Website Footer" label).
 */
export class NewsletterRepository {
  static async getSubscribers() {
    try {
      const rows = await prisma.newsletter_subscribers.findMany({
        orderBy: { created_at: "desc" },
      });

      return rows.map((r) => ({
        id: r.id,
        email: r.email,
        first_name: null as string | null,
        last_name: null as string | null,
        source: null as string | null,
        status: r.is_active === false ? "Unsubscribed" : "Active",
        subscribed_at: r.created_at ? r.created_at.toISOString() : null,
      }));
    } catch (err) {
      console.error("Unexpected error in getSubscribers:", err);
      return [];
    }
  }
}
