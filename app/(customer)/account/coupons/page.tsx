import { createDbClient } from "@/lib/db/client";
import { CouponRepository } from "@/lib/repositories/marketing/coupon.repository";
import { CouponsClient } from "./coupons-client";
import { formatCurrency } from "@/lib/utils";

export default async function CouponsPage() {
  const db = await createDbClient();
  const { data: { user } } = await db.auth.getUser();

  // We should ideally fetch all coupons and then check user usages if needed.
  // For simplicity, we just show active ones.
  const allCoupons = await CouponRepository.getCoupons();
  
  // Also get user's used coupons
  let usedCouponIds = new Set<string>();
  if (user) {
    const { data: usages } = await db
      .from("coupon_usages")
      .select("coupon_id")
      .eq("customer_id", user.id);
    if (usages) {
      usages.forEach((u: any) => usedCouponIds.add(u.coupon_id));
    }
  }

  const mappedCoupons = allCoupons.map((c: any) => {
    const isUsed = usedCouponIds.has(c.id);
    let type = isUsed ? "Used" : (c.is_active ? "Available" : "Expired");
    
    // Check expiry (null valid_until = open-ended, never expires)
    const now = new Date();
    const validUntil = c.valid_until ? new Date(c.valid_until) : null;
    if (validUntil && validUntil < now) type = "Expired";

    let discountStr = "";
    if (c.discount_type === "PERCENTAGE") {
      discountStr = `${c.value}% OFF`;
    } else {
      discountStr = `${formatCurrency(c.value)} OFF`;
    }

    let expiryStr = validUntil
      ? `Valid until ${validUntil.toLocaleDateString()}`
      : "No expiry";
    if (isUsed) expiryStr = "Already Used";
    if (type === "Expired") expiryStr = "Expired";

    return {
      id: c.id,
      code: c.code,
      discount: discountStr,
      description: `Min. order: ${c.min_order_value ? formatCurrency(c.min_order_value) : 'None'}`,
      expiry: expiryStr,
      type: type,
      recommended: c.discount_type === "PERCENTAGE" && c.value >= 20 && type === "Available",
    };
  });

  // Only pass available or used
  const displayCoupons = mappedCoupons.filter(c => c.type === "Available" || c.type === "Used");

  return <CouponsClient coupons={displayCoupons} />;
}
