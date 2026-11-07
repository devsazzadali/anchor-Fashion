import { createDbClient } from "@/lib/db/client";
import { LoyaltyAccount, LoyaltyTransaction } from "@/types/customer.types";

export class LoyaltyRepository {
  static async getAccount(userId: string): Promise<LoyaltyAccount | null> {
    const db = await createDbClient();
    const { data, error } = await db
      .from("loyalty_accounts")
      .select("*")
      .eq("customer_id", userId)
      .single();

    if (error) {
      console.error("Error fetching loyalty account:", error);
      return null;
    }
    return data;
  }

  static async getTransactions(
    accountId: string
  ): Promise<LoyaltyTransaction[]> {
    const db = await createDbClient();
    const { data, error } = await db
      .from("loyalty_transactions")
      .select("*")
      .eq("loyalty_account_id", accountId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching loyalty transactions:", error);
      return [];
    }
    return data;
  }
}
