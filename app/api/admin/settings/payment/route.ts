import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/db/client";
import { verifyAdmin } from "@/lib/security/roles";

/**
 * Admin-only API endpoint to save payment gateway credentials to the settings table.
 * The client-side PaymentProvidersForm POSTs here.
 */
export async function POST(req: Request) {
  const db = await createDbClient();
  try {
    // Verify admin session via the shared role guard. The previous check
    // compared app_metadata.role to lowercase "admin"/"super_admin", but
    // resolved roles are uppercase ("ADMIN"/"SUPER_ADMIN") — no real admin
    // could ever pass, so saving payment settings always failed with 403.
    try {
      await verifyAdmin();
    } catch (authErr: any) {
      const status = authErr?.message === "Unauthorized" ? 401 : 403;
      return NextResponse.json(
        { success: false, error: authErr?.message || "Forbidden" },
        { status }
      );
    }

    const body = await req.json();
    const { key, value } = body;

    if (!key || !value) {
      return NextResponse.json(
        { success: false, error: "Missing key or value" },
        { status: 400 }
      );
    }

    const allowedKeys = [
      "payment_bkash",
      "payment_sslcommerz",
      "store_info",
      "social_links",
    ];
    if (!allowedKeys.includes(key)) {
      return NextResponse.json(
        { success: false, error: "Invalid settings key" },
        { status: 400 }
      );
    }

    let finalValue = value;
    if (key === "payment_sslcommerz" && typeof value === "object") {
      const pass = (
        value.store_password ||
        value.store_pass ||
        value.store_passwd ||
        ""
      ).toString().trim();
      const isSandbox =
        value.sandbox !== undefined
          ? value.sandbox === true || value.sandbox === "true"
          : value.is_sandbox !== undefined
          ? value.is_sandbox === true || value.is_sandbox === "true"
          : true;

      let resolvedPass = pass;
      if (pass === "••••••••" || pass === "********" || pass === "") {
        const { data: existing } = await db
          .from("settings")
          .select("value")
          .eq("key", "payment_sslcommerz")
          .maybeSingle();
        const existingVal = existing?.value as Record<string, any> | null;
        resolvedPass = (
          existingVal?.store_password ||
          existingVal?.store_pass ||
          existingVal?.store_passwd ||
          ""
        ).toString().trim();
      } else if (pass) {
        try {
          const { encrypt } = await import("@/utils/encryption.util");
          resolvedPass = encrypt(pass);
        } catch (encErr) {
          console.warn("[Admin Payment Settings] Encryption failed, storing as-is:", encErr);
        }
      }

      finalValue = {
        ...value,
        store_id: (value.store_id || "").toString().trim(),
        store_password: resolvedPass,
        store_pass: resolvedPass,
        store_passwd: resolvedPass,
        sandbox: isSandbox ? "true" : "false",
        is_sandbox: isSandbox,
      };
    }

    const { error } = await db
      .from("settings")
      .upsert(
        { key, value: finalValue, description: `Payment gateway configuration for ${key}` },
        { onConflict: "key" }
      );

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[Admin Settings API] Error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
