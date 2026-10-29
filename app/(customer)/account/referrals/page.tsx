import { ReferralDashboard } from "./referral-dashboard";
import { ReferralService } from "@/services/referral.service";
import { createDbClient } from "@/lib/db/client";
import { redirect } from "next/navigation";

export default async function ReferralsPage() {
  const db = await createDbClient();
  const { data: { user } } = await db.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const { referralCode, stats, history } = await ReferralService.getReferralStats(user.id);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://anchorfashion.com";

  return (
    <ReferralDashboard 
      referralCode={referralCode}
      stats={stats}
      history={history}
      appUrl={appUrl}
    />
  );
}

