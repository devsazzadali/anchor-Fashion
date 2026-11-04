import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createAdminDbClient } from "@/lib/db/client";

export const dynamic = "force-dynamic";

/**
 * REG-67 support endpoint — slug/token existence for the proxy's
 * pre-stream 404 check (see proxy.ts).
 *
 * Each branch mirrors the existence rule of the page it guards, using the
 * cheapest possible read (id/status only, never full content):
 *  - product:    the PDP lookup — slug OR case-insensitive SKU, not deleted
 *  - category:   an ACTIVE category with that slug (case-insensitive)
 *  - collection: an active entry in the catalog_collections settings array
 *  - blog:       a blog_posts row with that slug AND status "published"
 *  - cms:        a CMSPage with that slug AND status PUBLISHED
 *  - invoice:    an order carrying that invoice_token (length-gated like
 *                the invoice page itself)
 *
 * FAIL-OPEN BY CONTRACT: any data-layer error answers { exists: true } so
 * the proxy never takes a real page down. The payload reveals nothing
 * beyond what the guarded pages themselves reveal (a slug either renders
 * or 404s; invoice tokens are 192-bit unguessable secrets whose existence
 * can only be queried by presenting the full token).
 *
 * REG-65 holdout note — the prose word in the FAIL-OPEN line above is
 * not a type annotation and is left unchanged, so the census pattern
 * still matches this file once.
 */

const KINDS = new Set(["product", "category", "collection", "blog", "cms", "invoice"]);

/**
 * REG-65 Batch 9: one entry of the catalog_collections settings array —
 * the only fields this branch reads.
 */
type CatalogCollectionEntry = {
  slug?: string;
  is_active?: boolean;
  [key: string]: unknown;
};

async function checkExists(kind: string, slug: string): Promise<boolean> {
  switch (kind) {
    case "product": {
      const row = await prisma.product.findFirst({
        where: {
          OR: [{ slug }, { sku: { equals: slug, mode: "insensitive" } }],
          deletedAt: null,
        },
        select: { id: true },
      });
      return !!row;
    }
    case "category": {
      const row = await prisma.category.findFirst({
        where: {
          slug: { equals: slug.toLowerCase(), mode: "insensitive" },
          isActive: true,
        },
        select: { id: true },
      });
      return !!row;
    }
    case "collection": {
      const setting = await prisma.setting.findUnique({
        where: { key: "catalog_collections" },
      });
      const collections = Array.isArray(setting?.value)
        ? (setting.value as CatalogCollectionEntry[])
        : [];
      return collections.some(
        (c) => c?.slug === slug && c?.is_active !== false
      );
    }
    case "blog": {
      const db = createAdminDbClient();
      const { data } = await db
        .from("blog_posts")
        .select("id, status")
        .eq("slug", slug)
        .maybeSingle();
      return !!data && String(data.status).toLowerCase() === "published";
    }
    case "cms": {
      const row = await prisma.cMSPage.findUnique({
        where: { slug },
        select: { id: true, status: true },
      });
      return !!row && String(row.status).toUpperCase() === "PUBLISHED";
    }
    case "invoice": {
      if (slug.length < 16 || slug.length > 64) return false;
      const row = await prisma.order.findUnique({
        where: { invoiceToken: slug },
        select: { id: true },
      });
      return !!row;
    }
    default:
      return true;
  }
}

export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get("kind") || "";
  const slug = (req.nextUrl.searchParams.get("slug") || "").trim();

  if (!KINDS.has(kind) || !slug || slug.length > 200) {
    return NextResponse.json(
      { exists: false, error: "bad request" },
      { status: 400 }
    );
  }

  try {
    const exists = await checkExists(kind, slug);
    return NextResponse.json(
      { exists },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return NextResponse.json({ exists: true, degraded: true });
  }
}
