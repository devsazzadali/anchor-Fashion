import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/db/client"; // Using the authenticated client helper if available, or direct

// Assuming we get the user from auth session
export async function POST(req: Request) {
  const db = await createDbClient();
  try {
    const {
      data: { session },
    } = await db.auth.getSession();

    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { endpoint, keys, userAgent } = await req.json();

    if (!endpoint || !keys) {
      return NextResponse.json(
        { message: "Invalid subscription data" },
        { status: 400 }
      );
    }

    // FIX ROUND 28 (M-4): push_subscriptions real columns are
    // (id, user_id, endpoint, keys, created_at) — the keys live in ONE
    // JSON column. The old payload's top-level p256dh / auth /
    // user_agent / last_used_at columns do not exist, so the builder
    // discarded the whole upsert while this route still returned
    // 201 "Subscription saved" (production table: 0 rows).
    const { data: saved, error } = await db.from("push_subscriptions").upsert(
      {
        user_id: session.user.id,
        endpoint,
        keys: { p256dh: keys.p256dh, auth: keys.auth },
      },
      { onConflict: "endpoint" }
    );

    if (error || !saved || (Array.isArray(saved) && saved.length === 0)) {
      return NextResponse.json(
        { message: "Internal Server Error" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { message: "Subscription saved" },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      { message: "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  const db = await createDbClient();
  try {
    const {
      data: { session },
    } = await db.auth.getSession();

    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { endpoint } = await req.json();

    if (!endpoint) {
      return NextResponse.json({ message: "Invalid data" }, { status: 400 });
    }

    const { error } = await db
      .from("push_subscriptions")
      .delete()
      .eq("user_id", session.user.id)
      .eq("endpoint", endpoint);

    if (error) {
      return NextResponse.json(
        { message: "Internal Server Error" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { message: "Subscription removed" },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      { message: "Internal Server Error" },
      { status: 500 }
    );
  }
}
