import webpush from "web-push";
import { createAdminDbClient } from "@/lib/db/client";

const publicVapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
const privateVapidKey = process.env.VAPID_PRIVATE_KEY || "";

if (publicVapidKey && privateVapidKey) {
  webpush.setVapidDetails(
    "mailto:support@anchorfashion.com",
    publicVapidKey,
    privateVapidKey
  );
} else {
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  url?: string;
}

export class PushService {
  /**
   * Save a push subscription to the database.
   */
  static async saveSubscription(userId: string, subscription: any) {
    const db = createAdminDbClient();
    const { keys, endpoint } = subscription;
    
    if (!keys || !keys.p256dh || !keys.auth || !endpoint) {
      throw new Error("Invalid subscription object");
    }

    // FIX ROUND 28 (sweep, M-4 class): push_subscriptions stores the
    // keys in ONE `keys` JSON column — top-level p256dh/auth columns
    // do not exist, so this upsert saved a keyless row (or nothing).
    const { data: saved, error } = await db.from("push_subscriptions").upsert(
      {
        user_id: userId,
        endpoint: endpoint,
        keys: { p256dh: keys.p256dh, auth: keys.auth },
      },
      { onConflict: "endpoint" }
    );

    if (error || !saved || (Array.isArray(saved) && saved.length === 0)) {
      throw new Error("Failed to save push subscription");
    }
  }

  /**
   * Send a push notification to a specific user.
   */
  static async sendToUser(userId: string, payload: PushNotificationPayload) {
    if (!publicVapidKey || !privateVapidKey) {
      return;
    }

    const db = createAdminDbClient();
    const { data: subscriptions, error } = await db
      .from("push_subscriptions")
      .select("*")
      .eq("user_id", userId);

    if (error || !subscriptions || subscriptions.length === 0) {
      return; // No subscriptions found
    }

    const stringPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      icon: payload.icon || "/icons/icon-192x192.png",
      badge: payload.badge || "/icons/badge-72x72.png",
      data: { url: payload.url || "/" }
    });

    const sendPromises = subscriptions.map(async (sub: any) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          // Round 28: keys live in the `keys` JSON column.
          p256dh: sub.keys?.p256dh,
          auth: sub.keys?.auth,
        },
      };

      try {
        await webpush.sendNotification(pushSubscription, stringPayload);
      } catch (err: any) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          // Subscription expired or unsubscribed, delete it from DB
          await db
            .from("push_subscriptions")
            .delete()
            .eq("id", sub.id);
        } else {
        }
      }
    });

    await Promise.allSettled(sendPromises);
  }
}
