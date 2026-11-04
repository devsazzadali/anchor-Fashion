// ============================================================================
// Sundarban Courier Provider
// API: https://www.sundarbanexpress.com/api (unofficial / partner API)
// ============================================================================

import {
  ICourierProvider,
  ConsignmentRequest,
  ConsignmentResponse,
  TrackingResult,
  TrackingUpdate,
  ProviderResponse,
  NormalizedWebhookEvent,
  ShipmentStatus,
} from "@/types/shipping.types";

type SundarbanTrackingEvent = {
  status: string;
  description?: string;
  location?: string;
  created_at: string;
};

export class SundarbanProvider implements ICourierProvider {
  readonly id = "sundarban" as const;
  readonly name = "Sundarban Courier";
  readonly isSandbox: boolean;

  private readonly apiKey: string;
  private readonly merchantCode: string;
  private readonly baseUrl = "https://www.sundarbanexpress.com/api/v1";

  constructor(config: Record<string, any>, isSandbox: boolean) {
    this.apiKey = config.apiKey ?? "";
    this.merchantCode = config.merchantCode ?? "";
    this.isSandbox = isSandbox;
  }

  private get headers() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      "Merchant-Code": this.merchantCode,
    };
  }

  async createConsignment(
    request: ConsignmentRequest
  ): Promise<ProviderResponse<ConsignmentResponse>> {
    try {
      const payload = {
        merchant_code: this.merchantCode,
        order_id: request.invoiceNumber,
        receiver_name: request.recipientName,
        receiver_phone: request.recipientPhone,
        receiver_address: request.recipientAddress,
        cod_amount: request.codAmount,
        weight: request.weight ?? 0.5,
        remarks: request.instructions ?? "",
      };

      const response = await fetch(`${this.baseUrl}/order/create`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (data.success && data.data?.tracking_number) {
        return {
          success: true,
          providerId: this.id,
          timestamp: new Date().toISOString(),
          data: {
            trackingCode: data.data.tracking_number,
            consignmentId: String(
              data.data.consignment_id || data.data.tracking_number
            ),
            status: "created",
          },
        };
      }

      return this.errorResponse(
        "API_ERROR",
        data.message || "Failed to create Sundarban order"
      );
    } catch (err) {
      return this.errorResponse("EXCEPTION", (err as Error).message);
    }
  }

  async cancelConsignment(
    consignmentId: string
  ): Promise<ProviderResponse<void>> {
    return {
      success: false,
      providerId: this.id,
      timestamp: new Date().toISOString(),
      error: {
        code: "NOT_SUPPORTED",
        message: "Sundarban requires manual cancellation via portal.",
      },
    };
  }

  async trackShipment(
    trackingCode: string
  ): Promise<ProviderResponse<TrackingResult>> {
    try {
      const response = await fetch(
        `${this.baseUrl}/order/track/${trackingCode}`,
        {
          method: "GET",
          headers: this.headers,
        }
      );

      const data = await response.json();

      if (data.success && data.data) {
        const updates: TrackingUpdate[] = (data.data.events || []).map(
          (e: SundarbanTrackingEvent) => ({
            status: e.status,
            statusDescription: e.description || e.status,
            location: e.location || "",
            timestamp: e.created_at,
            raw: e,
          })
        );

        return {
          success: true,
          providerId: this.id,
          timestamp: new Date().toISOString(),
          data: {
            status: this.normalizeStatus(data.data.current_status || ""),
            statusDescription: data.data.current_status || "",
            estimatedDelivery: null,
            updates,
          },
        };
      }

      return this.errorResponse("API_ERROR", "Tracking not found");
    } catch (err) {
      return this.errorResponse("EXCEPTION", (err as Error).message);
    }
  }

  async generateLabel(
    consignmentId: string
  ): Promise<ProviderResponse<{ labelUrl: string }>> {
    return {
      success: true,
      providerId: this.id,
      timestamp: new Date().toISOString(),
      data: { labelUrl: `https://sundarbanexpress.com/label/${consignmentId}` },
    };
  }

  async processWebhook(
    payload: unknown,
    signature: string
  ): Promise<ProviderResponse<NormalizedWebhookEvent>> {
    try {
      const body = payload as Record<string, any>;

      return {
        success: true,
        providerId: this.id,
        timestamp: new Date().toISOString(),
        data: {
          trackingNumber: body.tracking_number || "",
          consignmentId: String(
            body.consignment_id || body.tracking_number || ""
          ),
          status: this.normalizeStatus(body.status || ""),
          statusDescription: body.status_description || body.status || "",
          location: body.location || "",
          eventTime: body.event_time || new Date().toISOString(),
          raw: body,
        },
      };
    } catch (err) {
      return this.errorResponse("WEBHOOK_ERROR", (err as Error).message);
    }
  }

  private normalizeStatus(raw: string): ShipmentStatus {
    const map: Record<string, ShipmentStatus> = {
      booking: "created",
      pickup: "picked_up",
      transit: "in_transit",
      delivery: "out_for_delivery",
      delivered: "delivered",
      return: "returned_to_origin",
      cancelled: "cancelled",
    };
    return map[raw.toLowerCase()] ?? "in_transit";
  }

  private errorResponse<T>(code: string, message: string): ProviderResponse<T> {
    return {
      success: false,
      providerId: this.id,
      timestamp: new Date().toISOString(),
      error: { code, message },
    };
  }
}
