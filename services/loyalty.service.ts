import { createDbClient, createAdminDbClient } from "@/lib/db/client";
import { LoyaltyRepository } from "@/repositories/loyalty.repository";
import { LoyaltyAccount, LoyaltyTransaction } from "@/types/customer.types";
import { WalletService } from "@/services/wallet.service";

/** Tier ladder, driven by lifetime earned points (shared by earn/reverse). */
function tierForTotalEarned(totalEarned: number): string {
  if (totalEarned >= 10000) return "VIP";
  if (totalEarned >= 5000) return "PLATINUM";
  if (totalEarned >= 2000) return "GOLD";
  return "SILVER";
}

export interface RewardCatalogItem {
  id: string;
  title: string;
  description: string;
  points_cost: number;
  reward_type: "DISCOUNT_VOUCHER" | "WALLET_CREDIT" | "FREE_SHIPPING" | "PHYSICAL_GIFT";
  reward_value: number;
  is_active: boolean;
  stock: number;
}

export class LoyaltyService {
  private static async getClient() {
    try {
      return await createAdminDbClient();
    } catch {
      return await createDbClient();
    }
  }

  static async getAccount(userId: string): Promise<LoyaltyAccount> {
    const existing = await LoyaltyRepository.getAccount(userId);
    if (existing) return existing;

    const db = await this.getClient();
    const { data: created, error } = await db
      .from("loyalty_accounts")
      .insert({
        customer_id: userId,
        tier: "SILVER",
        points_balance: 0,
        total_points_earned: 0,
        total_points_redeemed: 0,
      })
      .select()
      .single();

    if (error) {
      console.error("Failed to auto-create loyalty account:", error);
      return {
        id: "",
        customer_id: userId,
        tier: "SILVER",
        points_balance: 0,
        total_points_earned: 0,
        total_points_redeemed: 0,
        tier_updated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }

    return created;
  }

  static async getTransactions(accountId: string): Promise<LoyaltyTransaction[]> {
    return LoyaltyRepository.getTransactions(accountId);
  }

  static async getCatalog(): Promise<RewardCatalogItem[]> {
    const db = await this.getClient();
    const { data, error } = await db
      .from("reward_catalog")
      .select("*")
      .eq("is_active", true)
      .order("points_cost", { ascending: true });
    
    if (error) {
      console.error("Failed to fetch reward catalog:", error);
      return [];
    }
    return data;
  }

  static async getSettings(): Promise<any> {
    const db = await this.getClient();
    const { data, error } = await db
      .from("settings")
      .select("value")
      .eq("key", "loyalty_rewards_settings")
      .single();
    
    if (error || !data) {
      return {
        points_per_currency: 1,
        currency_amount: 100,
        min_order_amount: 1000,
        signup_bonus: 50
      };
    }
    return data.value;
  }

  static async earnPoints(params: {
    userId: string;
    points: number;
    description?: string;
    referenceType?: string;
    referenceId?: string;
  }): Promise<{ account: LoyaltyAccount; pointsEarned: number }> {
    if (params.points <= 0) {
      throw new Error("Points to earn must be greater than zero");
    }

    const account = await this.getAccount(params.userId);
    const db = await this.getClient();

    const isUuid = Boolean(
      params.referenceId &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.referenceId)
    );

    const refId = isUuid ? params.referenceId : null;

    // Idempotency: never earn twice for the same reference. The DB enforces
    // this with a partial unique index (uq_loyalty_earn_ref on EARN rows);
    // pre-check here so the common path returns cleanly instead of relying
    // on the constraint violation below.
    if (refId) {
      const { data: existingEarn } = await db
        .from("loyalty_transactions")
        .select("id")
        .eq("loyalty_account_id", account.id)
        .eq("reference_type", params.referenceType || "MANUAL")
        .eq("reference_id", refId)
        .eq("type", "EARN")
        .maybeSingle();
      if (existingEarn) {
        console.warn(`Idempotency check: Points already earned for ${params.referenceType} ${refId}`);
        return { account, pointsEarned: 0 };
      }
    }

    // Insert transaction. The DB partial unique constraint prevents double earning for the same referenceId and type.
    const { error: insertError } = await db.from("loyalty_transactions").insert({
      loyalty_account_id: account.id,
      type: "EARN",
      points: params.points,
      description: params.description || `Earned ${params.points} loyalty points`,
      reference_type: params.referenceType || "MANUAL",
      reference_id: refId,
    });

    if (insertError) {
      if (insertError.code === "23505") { // unique_violation
        console.warn(`Idempotency check: Points already earned for ${params.referenceType} ${refId}`);
        return { account, pointsEarned: 0 };
      }
      throw new Error(`Failed to insert loyalty transaction: ${insertError.message}`);
    }

    const newBalance = account.points_balance + params.points;
    const newTotalEarned = account.total_points_earned + params.points;

    const newTier = tierForTotalEarned(newTotalEarned);

    const { data: updatedAccount, error: updateError } = await db
      .from("loyalty_accounts")
      .update({
        points_balance: newBalance,
        total_points_earned: newTotalEarned,
        tier: newTier,
        tier_updated_at: newTier !== account.tier ? new Date().toISOString() : account.tier_updated_at,
        updated_at: new Date().toISOString(),
      })
      .eq("id", account.id)
      .select()
      .single();

    if (updateError || !updatedAccount) {
      throw new Error(`Failed to update loyalty balance: ${updateError?.message}`);
    }

    return { account: updatedAccount, pointsEarned: params.points };
  }

  /**
   * Reverse points previously earned for a reference (e.g. a cancelled,
   * refunded or returned order).
   *
   * Implemented in the service layer: the Postgres functions this used to
   * call do not exist in the Prisma-managed schema, and the data layer's
   * fallback for them read different argument names than this service
   * passes — so reversals silently never happened and cancelled orders
   * kept their points.
   */
  static async reversePoints(params: {
    userId: string;
    referenceId: string;
    pointsToReverse: number;
    reason: string;
  }): Promise<{ success: boolean; pointsReversed: number; newBalance?: number; reason?: string }> {
    const db = await this.getClient();

    const account = await LoyaltyRepository.getAccount(params.userId);
    if (!account) {
      return { success: false, pointsReversed: 0, reason: "No loyalty account" };
    }

    const { data: earnTx } = await db
      .from("loyalty_transactions")
      .select("*")
      .eq("loyalty_account_id", account.id)
      .eq("reference_id", params.referenceId)
      .eq("type", "EARN")
      .maybeSingle();

    if (!earnTx) {
      return {
        success: false,
        pointsReversed: 0,
        reason: "No earned points found for this reference",
      };
    }

    // Idempotency: a reference can only be reversed once.
    const { data: existingReversal } = await db
      .from("loyalty_transactions")
      .select("id")
      .eq("loyalty_account_id", account.id)
      .eq("reference_id", params.referenceId)
      .eq("type", "REVERSAL")
      .maybeSingle();

    if (existingReversal) {
      return { success: false, pointsReversed: 0, reason: "Already reversed" };
    }

    const earned = Number(earnTx.points || 0);
    const balance = Number(account.points_balance || 0);
    const toReverse = Math.min(params.pointsToReverse, earned, balance);
    if (toReverse <= 0) {
      return { success: false, pointsReversed: 0, reason: "Nothing to reverse" };
    }

    const { error: insertError } = await db.from("loyalty_transactions").insert({
      loyalty_account_id: account.id,
      type: "REVERSAL",
      points: -toReverse,
      description: params.reason,
      reference_type: earnTx.reference_type || "ORDER",
      reference_id: params.referenceId,
    });
    if (insertError) {
      throw new Error(`Failed to record points reversal: ${insertError.message}`);
    }

    const newBalance = balance - toReverse;
    const newTotalEarned = Math.max(
      0,
      Number(account.total_points_earned || 0) - toReverse
    );
    const newTier = tierForTotalEarned(newTotalEarned);

    const { error: updateError } = await db
      .from("loyalty_accounts")
      .update({
        points_balance: newBalance,
        total_points_earned: newTotalEarned,
        tier: newTier,
        tier_updated_at:
          newTier !== account.tier
            ? new Date().toISOString()
            : account.tier_updated_at,
        updated_at: new Date().toISOString(),
      })
      .eq("id", account.id);

    if (updateError) {
      throw new Error(`Failed to update loyalty balance: ${updateError.message}`);
    }

    return { success: true, pointsReversed: toReverse, newBalance };
  }

  /**
   * Redeem points for a reward-catalog item.
   *
   * Implemented in the service layer for the same reason as reversePoints:
   * the RPC it used to call does not exist and the fallback silently
   * no-opped while callers reported success — customers were told
   * "Redeemed!" and issued voucher code `undefined`, with no points
   * deducted and nothing delivered.
   *
   * Behaviour: validates the reward (active) and the balance, deducts the
   * points, logs a REDEEM transaction, and delivers the reward —
   * DISCOUNT-type rewards with a value become a single-use coupon in the
   * normal coupon system; WALLET_CREDIT rewards credit the wallet through
   * the internal WalletService credit path; other reward types return a
   * redemption code recorded on the transaction for staff to honour.
   */
  static async redeemPoints(params: {
    userId: string;
    rewardId: string;
  }): Promise<{ success: boolean; voucherCode?: string; pointsDeducted?: number; newBalance?: number; error?: string }> {
    const db = await this.getClient();

    const { data: reward, error: rewardError } = await db
      .from("reward_catalog")
      .select("*")
      .eq("id", params.rewardId)
      .eq("is_active", true)
      .maybeSingle();

    if (rewardError) {
      throw new Error(`Failed to load reward: ${rewardError.message}`);
    }
    if (!reward) {
      return { success: false, error: "Reward not found or no longer available." };
    }

    const account = await this.getAccount(params.userId);
    const balance = Number(account.points_balance || 0);
    const cost = Number(reward.points_cost || 0);
    if (balance < cost) {
      return { success: false, error: "Not enough points to redeem this reward." };
    }

    const rewardType = String(reward.reward_type || "DISCOUNT").toUpperCase();
    const value = Number(reward.discount_value || 0);
    const redemptionRef = crypto.randomUUID();

    // 1. Deduct points + log the redemption first, so a delivery failure
    //    can be compensated by re-crediting the points.
    const newBalance = balance - cost;
    const { error: txError } = await db.from("loyalty_transactions").insert({
      loyalty_account_id: account.id,
      type: "REDEEM",
      points: -cost,
      description: `Redeemed: ${reward.title}`,
      reference_type: "REWARD",
      reference_id: params.rewardId,
    });
    if (txError) {
      throw new Error(`Failed to record redemption: ${txError.message}`);
    }

    const { error: updateError } = await db
      .from("loyalty_accounts")
      .update({
        points_balance: newBalance,
        total_points_redeemed:
          Number(account.total_points_redeemed || 0) + cost,
        updated_at: new Date().toISOString(),
      })
      .eq("id", account.id);
    if (updateError) {
      throw new Error(`Failed to update loyalty balance: ${updateError.message}`);
    }

    // 2. Deliver the reward; on failure, re-credit the points.
    try {
      let voucherCode: string | undefined;

      if (rewardType === "WALLET_CREDIT" && value > 0) {
        await WalletService.topUp({
          userId: params.userId,
          amount: value,
          paymentMethod: "LOYALTY_REWARD",
          paymentRef: redemptionRef,
          description: `Loyalty reward credit: ${reward.title}`,
        });
      } else {
        voucherCode = `ANCHOR-${redemptionRef.replace(/-/g, "").slice(0, 10).toUpperCase()}`;
        if (value > 0) {
          const { error: couponError } = await db.from("coupons").insert({
            code: voucherCode,
            description: `Loyalty reward: ${reward.title}`,
            discount_type: "FIXED",
            discount_value: value,
            usage_limit: 1,
            is_active: true,
          });
          if (couponError) throw couponError;
        }
      }

      return {
        success: true,
        voucherCode,
        pointsDeducted: cost,
        newBalance,
      };
    } catch (deliveryError: any) {
      // Compensate: give the points back and mark the redemption reversed.
      await db.from("loyalty_transactions").insert({
        loyalty_account_id: account.id,
        type: "REVERSAL",
        points: cost,
        description: `Redemption failed, points restored: ${reward.title}`,
        reference_type: "REWARD",
        reference_id: params.rewardId,
      });
      await db
        .from("loyalty_accounts")
        .update({
          points_balance: balance,
          total_points_redeemed: Number(account.total_points_redeemed || 0),
          updated_at: new Date().toISOString(),
        })
        .eq("id", account.id);
      throw new Error(
        `Redemption failed: ${deliveryError.message || "delivery error"}`
      );
    }
  }
}
