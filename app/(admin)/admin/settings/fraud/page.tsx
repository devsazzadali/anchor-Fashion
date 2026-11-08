import { Metadata } from "next";
import {
  getCodFraudSettings,
  getExternalFraudSettings,
} from "@/lib/actions/settings.actions";
import { FraudSettingsClient } from "./FraudSettingsClient";

export const metadata: Metadata = {
  title: "Fraud Checks | Admin",
  description:
    "Configure the COD fraud shield thresholds, OTP rules, and the external BDCourier phone check.",
};

export const dynamic = "force-dynamic";

export default async function FraudSettingsPage() {
  const [codConfig, externalConfig] = await Promise.all([
    getCodFraudSettings(),
    getExternalFraudSettings(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Fraud Checks</h1>
        <p className="mt-1 text-muted-foreground">
          COD fraud shield thresholds and OTP rules, plus the external
          fraud check by phone number (BDCourier) that runs when an order
          is placed.
        </p>
      </div>

      <FraudSettingsClient
        initialCodConfig={codConfig}
        initialExternalConfig={externalConfig}
      />
    </div>
  );
}
