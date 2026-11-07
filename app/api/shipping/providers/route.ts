import { NextResponse } from "next/server";
import { createAdminDbClient } from "@/lib/db/client";

export async function GET() {
  try {
    const db = createAdminDbClient();
    const { data, error } = await db
      .from("courier_providers")
      .select(
        "id, code, name, display_name, logo_url, is_active, is_cod_supported, is_sandbox, priority"
      )
      .order("priority");

    if (error) throw error;
    return NextResponse.json({ data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
