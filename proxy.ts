import { auth } from "@/lib/auth/server";
import { NextResponse, type NextRequest } from "next/server";

const authHandler = auth.middleware({ loginUrl: "/auth/login" });

// ===========================================================================
// REG-67 — real HTTP 404 for missing public slugs.
//
// Every public detail page already calls notFound() for a missing
// product/category/page/token — but the root app/loading.tsx makes every
// response STREAM, and per the Next.js docs a streamed not-found renders
// the branded 404 body with status 200 ("soft-404"). The docs' sanctioned
// remedy: "ensure the resource exists before the response body is
// streamed… run this check in proxy to rewrite missing slugs to a
// not-found route" (docs: file-conventions/loading#status-codes).
//
// So: for the public slug routes, ask the internal existence endpoint
// (app/api/internal/exists — cheap id-only reads mirroring each page's
// own lookup rule). A confirmed miss is rewritten to a path that matches
// NO route, so the routing layer serves the root not-found.tsx with a
// real 404 status. The check FAILS OPEN: any error/timeout/non-200 from
// the endpoint lets the request through untouched, so a data-layer
// problem can never take real pages down. Protected prefixes keep the
// original auth flow below, byte for byte.
// ===========================================================================

const NOT_FOUND_SENTINEL = "/not-found/404";
const EXISTS_TIMEOUT_MS = 1500;

/** Prefixes owned by the original auth matcher — never intercepted here. */
const AUTH_PREFIXES = [
  "/account",
  "/admin",
  "/manager",
  "/dashboard",
  "/customers",
  "/loyalty",
  "/executive",
  "/analytics",
  "/inventory",
  "/monitoring",
  "/operations",
  "/revenue",
  "/sales",
  "/ai-insights",
  "/ai",
];

/** Two-segment public slug routes -> existence kind. */
const SLUG_ROUTES: { prefix: string; kind: string }[] = [
  { prefix: "/product/", kind: "product" },
  { prefix: "/products/", kind: "product" },
  { prefix: "/categories/", kind: "category" },
  { prefix: "/collections/", kind: "collection" },
  { prefix: "/blog/", kind: "blog" },
  { prefix: "/invoice/", kind: "invoice" },
];

/**
 * Every real top-level route segment that is NOT a CMS page. The
 * single-segment branch below treats anything else as a CMS slug, so
 * this list must stay complete — it is derived from the app tree
 * (all route groups' top-level pages) plus structural segments.
 */
const STATIC_TOP_LEVEL = new Set([
  "about", "account", "admin", "ai-insights", "analytics", "api", "auth",
  "blog", "brands", "cart", "categories", "checkout", "collections",
  "contact", "cookies", "customers", "dashboard", "executive",
  "flash-deals", "inventory", "invoice", "loyalty", "maintenance",
  "manager", "monitoring", "not-found", "operations", "privacy",
  "product", "products", "revenue", "sales", "search", "settings",
  "support", "terms", "track-order", "~offline",
]);

function applySecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return response;
}

function rewriteToNotFound(request: NextRequest): NextResponse {
  return applySecurityHeaders(
    NextResponse.rewrite(new URL(NOT_FOUND_SENTINEL, request.url))
  );
}

async function slugExists(
  request: NextRequest,
  kind: string,
  slug: string
): Promise<boolean> {
  try {
    const url = new URL("/api/internal/exists", request.url);
    url.searchParams.set("kind", kind);
    url.searchParams.set("slug", slug);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EXISTS_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "x-reg67-check": "1" },
    });
    clearTimeout(timer);
    if (!res.ok) return true; // fail open
    const body = await res.json().catch(() => null);
    return body?.exists !== false;
  } catch {
    return true; // fail open
  }
}

/**
 * Returns a response for public paths (rewrite-404 or pass-through), or
 * null for the protected prefixes, which keep the original auth flow.
 */
async function handlePublicNotFound(
  request: NextRequest
): Promise<NextResponse | null> {
  const { pathname } = request.nextUrl;

  if (
    AUTH_PREFIXES.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`)
    )
  ) {
    return null;
  }

  if (
    pathname === NOT_FOUND_SENTINEL ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/")
  ) {
    return NextResponse.next();
  }

  for (const { prefix, kind } of SLUG_ROUTES) {
    if (pathname.startsWith(prefix)) {
      const rawSlug = pathname.slice(prefix.length);
      if (!rawSlug || rawSlug.includes("/")) return NextResponse.next();
      // Preview mode is authorized by the page itself — never pre-empt it.
      if (
        kind === "blog" &&
        request.nextUrl.searchParams.get("preview") === "true"
      ) {
        return NextResponse.next();
      }
      let slug = rawSlug;
      try {
        slug = decodeURIComponent(rawSlug);
      } catch {}
      const exists = await slugExists(request, kind, slug);
      return exists ? NextResponse.next() : rewriteToNotFound(request);
    }
  }

  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 1) {
    const slug = segments[0];
    if (slug.includes(".") || STATIC_TOP_LEVEL.has(slug)) {
      return NextResponse.next();
    }
    if (request.nextUrl.searchParams.get("preview") === "true") {
      return NextResponse.next();
    }
    const exists = await slugExists(request, "cms", slug);
    return exists ? NextResponse.next() : rewriteToNotFound(request);
  }

  return NextResponse.next();
}

export async function proxy(request: NextRequest) {
  const publicResponse = await handlePublicNotFound(request);
  if (publicResponse) return publicResponse;

  const response = await authHandler(request);

  // Apply enterprise security headers
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  return response;
}

export default proxy;

export const config = {
  matcher: [
    "/account/:path*",
    "/admin/:path*",
    "/manager/:path*",
    "/dashboard/:path*",
    "/customers/:path*",
    "/loyalty/:path*",
    "/executive/:path*",
    "/analytics/:path*",
    "/inventory/:path*",
    "/monitoring/:path*",
    "/operations/:path*",
    "/revenue/:path*",
    "/sales/:path*",
    "/ai-insights/:path*",
    "/ai/:path*",
    // REG-67: public slug routes guarded by the existence check above.
    "/product/:slug",
    "/products/:slug",
    "/categories/:slug",
    "/collections/:slug",
    "/blog/:slug",
    "/invoice/:token",
    "/:slug",
  ],
};
