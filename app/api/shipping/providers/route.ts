import { NextResponse } from "next/server";
import { createAdminDbClient } from "@/lib/db/client";

export async function GET() {
  try {
    const db = createAdminDbClient();
    // FIX ROUND 28 (M-9): courier_providers real columns are
    // (id, code, name, is_active, api_key, api_secret, config,
    // created_at). The old select named display_name / logo_url /
    // is_cod_supported / is_sandbox / priority — none exist — and the
    // `.order("priority")` alone poisoned the read, so this route
    // returned an empty list forever. Credentials are never selected.
    const { data, error } = await db
      .from("courier_providers")
      .select("id, code, name, is_active, created_at")
      .order("name");

    if (error) throw error;
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
