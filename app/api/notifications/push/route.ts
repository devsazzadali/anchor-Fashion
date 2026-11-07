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

    const { error } = await db.from("push_subscriptions").upsert(
      {
        user_id: session.user.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        user_agent: userAgent || req.headers.get("user-agent"),
        last_used_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" }
    );

    if (error) {
      console.error("Failed to save push subscription:", error);
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
    console.error("Push subscription error:", error);
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
      console.error("Failed to remove push subscription:", error);
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
    console.error("Push subscription delete error:", error);
    return NextResponse.json(
      { message: "Internal Server Error" },
      { status: 500 }
    );
  }
}
