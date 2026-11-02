import { createDbClient } from "@/lib/db/client";
import { PaymentProvider, PaymentProviderCode } from "@/types/payment.types";

export class PaymentProviderRepository {
  /**
   * Get all payment providers.
   * FIX ROUND 28 (M-5): payment_providers has NO `status` column —
   * the active flag is `is_active`. The old `.eq("status", "active")`
   * filter poisoned the query (empty result). Rows are mapped back
   * with a derived `status` for type compatibility.
   */
  async getProviders(activeOnly: boolean = false): Promise<PaymentProvider[]> {
    const db = await createDbClient();
    let query = db.from("payment_providers").select("*");

    if (activeOnly) {
      query = query.eq("is_active", true);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch payment providers: ${error.message}`);
    }

    return (data || []).map((p: any) => ({
      ...p,
      status: p.is_active ? "active" : "inactive",
    })) as PaymentProvider[];
  }

  /**
   * Get provider by Code
   */
  async getProviderByCode(
    code: PaymentProviderCode
  ): Promise<PaymentProvider | null> {
    const db = await createDbClient();
    const { data, error } = await db
      .from("payment_providers")
      .select("*")
      .eq("code", code)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw new Error(`Failed to fetch provider: ${error.message}`);
    }

    return data as PaymentProvider;
  }

  /**
   * Update provider config.
   * FIX ROUND 28 (M-5): translates the legacy payload to real columns
   * — `status: "active"|"inactive"` becomes `is_active`; `is_fallback`
   * and `supported_currencies` have no columns and are dropped
   * explicitly instead of poisoning/silently vanishing.
   */
  async updateProvider(
    id: string,
    data: Partial<PaymentProvider>
  ): Promise<void> {
    const db = await createDbClient();
    const payload: Record<string, any> = { ...(data as any) };
    if (payload.status !== undefined) {
      payload.is_active = payload.status === "active";
      delete payload.status;
    }
    delete payload.is_fallback;
    delete payload.supported_currencies;
    const { error } = await db
      .from("payment_providers")
      .update(payload)
      .eq("id", id);

    if (error) {
      throw new Error(`Failed to update provider: ${error.message}`);
    }
  }

  /**
   * Get fallback provider.
   * FIX ROUND 28 (M-5): no `is_fallback`/`status` columns exist — the
   * fallback is the lowest-sort_order active provider.
   */
  async getFallbackProvider(): Promise<PaymentProvider | null> {
    const db = await createDbClient();
    const { data, error } = await db
      .from("payment_providers")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw new Error(`Failed to fetch fallback provider: ${error.message}`);
    }
    if (!data) return null;
    return {
      ...(data as any),
      status: (data as any).is_active ? "active" : "inactive",
    } as PaymentProvider;
  }
}
