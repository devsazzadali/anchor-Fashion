import crypto from "crypto";
import { QueueService } from "@/services/jobs/queue.service";
import { createAdminDbClient } from "@/lib/db/client";

export class WebhookService {
  /**
   * Verifies the HMAC signature of an incoming webhook payload
   */
  static verifySignature(
    payload: string,
    signature: string,
    secret: string,
    algorithm: string = "sha256"
  ): boolean {
    try {
      const hmac = crypto.createHmac(algorithm, secret);
      const digest = hmac.update(payload).digest("hex");

      // Use timingSafeEqual to prevent timing attacks
      const signatureBuffer = Buffer.from(signature);
      const digestBuffer = Buffer.from(digest);

      if (signatureBuffer.length !== digestBuffer.length) {
        return false;
      }

      return crypto.timingSafeEqual(signatureBuffer, digestBuffer);
    } catch (error) {
      return false;
    }
  }

  /**
   * Dispatches an incoming webhook event to the background job queue for async processing
   */
  static async enqueueIncomingWebhook(
    eventType: string,
    provider: string,
    payload: Record<string, unknown>
  ): Promise<boolean> {
    return await QueueService.pushJob({
      eventType: `WEBHOOK_IN_${eventType.toUpperCase()}`,
      source: provider,
      payload,
    });
  }

  /**
   * Triggers an outgoing webhook (e.g., notifying external partners of an order update)
   * It pushes to the webhook_deliveries queue to be retried automatically.
   */
  static async triggerOutgoingWebhook(
    webhookId: string,
    eventType: string,
    payload: Record<string, unknown>
  ): Promise<boolean> {
    try {
      const db = createAdminDbClient();

      const { error } = await db.from("webhook_deliveries").insert({
        webhook_id: webhookId,
        event_type: eventType,
        payload: payload,
        status: "pending",
      });

      if (error) {
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }
}
