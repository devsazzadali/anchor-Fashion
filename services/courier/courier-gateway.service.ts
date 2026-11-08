// ============================================================================
// Courier Gateway Service — Updated to use CourierRegistry
// ============================================================================

import { CourierRegistry } from "./courier-registry";
import { logCourierApiCall } from "@/lib/couriers/logger";
import {
  ConsignmentRequest,
  ConsignmentResponse,
  TrackingResult,
  ProviderResponse,
  NormalizedWebhookEvent,
  CourierProviderCode,
  ICourierProvider,
} from "@/types/shipping.types";

export class CourierGatewayService {
  private static registry = CourierRegistry.getInstance();

  /**
   * Get provider — with optional fallback on failure
   */
  private static async getProvider(
    code: CourierProviderCode,
    useFallback = false
  ): Promise<ICourierProvider> {
    try {
      return await this.registry.get(code);
    } catch (err) {
      if (useFallback) {
        const fallback = await this.registry.getFallback();
        if (fallback) return fallback;
      }
      throw err;
    }
  }

  /**
   * Create consignment with the provider the operator explicitly chose.
   *
   * Phase 8: the previous implementation silently retried with the
   * registry "fallback" provider on failure — which resolved to the
   * sandbox mock and FABRICATED a successful consignment (fake tracking
   * number) when the real courier rejected or was unconfigured. A failed
   * booking is now returned as a failure, verbatim.
   */
  static async createConsignment(
    code: CourierProviderCode,
    request: ConsignmentRequest
  ): Promise<ProviderResponse<ConsignmentResponse>> {
    const started = Date.now();
    let result: ProviderResponse<ConsignmentResponse>;
    try {
      const provider = await this.getProvider(code);
      result = await provider.createConsignment(request);
    } catch (err: any) {
      result = this.buildError(code, err.message);
    }
    // Record the call so Admin → Couriers → Logs reflects real dispatch
    // traffic (the logger sanitizes credentials and never throws).
    await logCourierApiCall({
      courierCode: code,
      method: "POST",
      endpoint: "createConsignment",
      statusCode: result.success ? 200 : 502,
      success: result.success,
      responseTimeMs: Date.now() - started,
      errorMessage: result.success ? undefined : result.error?.message,
      payload: request,
      responseData: result,
    });
    return result;
  }

  /**
   * Cancel consignment
   */
  static async cancelConsignment(
    code: CourierProviderCode,
    consignmentId: string
  ): Promise<ProviderResponse<void>> {
    const started = Date.now();
    let result: ProviderResponse<void>;
    try {
      const provider = await this.getProvider(code);
      result = await provider.cancelConsignment(consignmentId);
    } catch (err: any) {
      result = this.buildError(code, err.message);
    }
    await logCourierApiCall({
      courierCode: code,
      method: "POST",
      endpoint: "cancelConsignment",
      statusCode: result.success ? 200 : 502,
      success: result.success,
      responseTimeMs: Date.now() - started,
      errorMessage: result.success ? undefined : result.error?.message,
      payload: { consignmentId },
      responseData: result,
    });
    return result;
  }

  /**
   * Track shipment
   */
  static async trackShipment(
    code: CourierProviderCode,
    trackingCode: string
  ): Promise<ProviderResponse<TrackingResult>> {
    const started = Date.now();
    let result: ProviderResponse<TrackingResult>;
    try {
      const provider = await this.getProvider(code);
      result = await provider.trackShipment(trackingCode);
    } catch (err: any) {
      result = this.buildError(code, err.message);
    }
    await logCourierApiCall({
      courierCode: code,
      method: "GET",
      endpoint: "trackShipment",
      statusCode: result.success ? 200 : 502,
      success: result.success,
      responseTimeMs: Date.now() - started,
      errorMessage: result.success ? undefined : result.error?.message,
      payload: { trackingCode },
      responseData: result,
    });
    return result;
  }

  /**
   * Generate label
   */
  static async generateLabel(
    code: CourierProviderCode,
    consignmentId: string
  ): Promise<ProviderResponse<{ labelUrl: string; labelData?: string }>> {
    const started = Date.now();
    let result: ProviderResponse<{ labelUrl: string; labelData?: string }>;
    try {
      const provider = await this.getProvider(code);
      result = await provider.generateLabel(consignmentId);
    } catch (err: any) {
      result = this.buildError(code, err.message);
    }
    await logCourierApiCall({
      courierCode: code,
      method: "POST",
      endpoint: "generateLabel",
      statusCode: result.success ? 200 : 502,
      success: result.success,
      responseTimeMs: Date.now() - started,
      errorMessage: result.success ? undefined : result.error?.message,
      payload: { consignmentId },
      responseData: result,
    });
    return result;
  }

  /**
   * Process incoming webhook from courier provider
   */
  static async processWebhook(
    code: CourierProviderCode,
    payload: unknown,
    signature: string
  ): Promise<ProviderResponse<NormalizedWebhookEvent>> {
    try {
      const provider = await this.getProvider(code);
      return provider.processWebhook(payload, signature);
    } catch (err: any) {
      return this.buildError(code, err.message);
    }
  }

  /**
   * Get all active providers (for UI selectors / dashboards)
   */
  static async getActiveProviders() {
    return this.registry.getActive();
  }

  /**
   * Force refresh the registry cache
   */
  static async refreshRegistry(): Promise<void> {
    this.registry.invalidate();
    await this.registry.load(true);
  }

  private static buildError(
    code: CourierProviderCode,
    message: string
  ): ProviderResponse<any> {
    return {
      success: false,
      providerId: code,
      timestamp: new Date().toISOString(),
      error: { code: "GATEWAY_ERROR", message },
    };
  }
}
