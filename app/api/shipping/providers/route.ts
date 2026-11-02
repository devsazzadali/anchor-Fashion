import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/shipping/providers — PUBLIC, unauthenticated.
 *
 * FIX ROUND 29 (D12, security): this route previously read
 * courier_providers through the lib/db query builder with
 * .select("id, code, name, is_active, created_at") — but the builder
 * never translates a select list into a Prisma `select` (see
 * lib/db/query.ts execute(): findMany runs with where/orderBy/take
 * only, and toSnakeRow then emits EVERY mapped column). The public
 * response therefore contained the full rows, including api_key,
 * api_secret and config.credentials.apiKey — live courier credentials
 * readable by anyone with curl.
 *
 * The route now queries Prisma directly with an explicit column
 * allowlist and builds each response object field-by-field, so no
 * credential material can reach the response even if the table grows
 * new secret columns later.
 *
 * Caller analysis: the only consumer is hooks/shipping/
 * use-courier-providers.ts → the admin "Courier Providers" page,
 * which renders id / code / name / is_active and the sandbox mode.
 * Mode lives in the non-secret config.is_sandbox flag, which is the
 * one config value exposed (as a bare boolean). Admins who need the
 * actual credentials use the manager-gated getCourierProvidersAction
 * (lib/actions/logistics.actions.ts), which returns them masked —
 * that remains the only credential surface.
 */
export async function GET() {
  try {
    const providers = await prisma.courier_providers.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        is_active: true,
        config: true,
        created_at: true,
      },
      orderBy: { name: "asc" },
    });

    const data = providers.map((p) => {
      const config = (p.config ?? {}) as Record<string, unknown>;
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        is_active: p.is_active,
        // Non-secret display flag only — config.credentials and every
        // other config key are deliberately never copied across.
        is_sandbox: config.is_sandbox === true || p.code === "sandbox",
        created_at: p.created_at,
      };
    });

    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
