"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  updateCodFraudSettings,
  updateExternalFraudSettings,
} from "@/lib/actions/settings.actions";
import type { CodFraudConfig } from "@/lib/services/fraud/cod-risk.service";
import type { FraudCheckSettings } from "@/lib/services/fraud/external-fraud.service";
import { toast } from "sonner";
import { Loader2, ShieldCheck, PhoneCall } from "lucide-react";

function NumberField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ToggleField({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div>
        <Label>{label}</Label>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function FraudSettingsClient({
  initialCodConfig,
  initialExternalConfig,
}: {
  initialCodConfig: CodFraudConfig;
  initialExternalConfig: FraudCheckSettings;
}) {
  const [cod, setCod] = useState<CodFraudConfig>(initialCodConfig);
  const [external, setExternal] =
    useState<FraudCheckSettings>(initialExternalConfig);
  const [savingCod, setSavingCod] = useState(false);
  const [savingExternal, setSavingExternal] = useState(false);

  const saveCod = async () => {
    setSavingCod(true);
    try {
      const res = await updateCodFraudSettings(cod);
      if (res.success) toast.success("COD fraud shield settings saved");
      else toast.error(res.error || "Failed to save COD fraud settings");
    } catch (e: any) {
      toast.error(e.message || "An error occurred");
    } finally {
      setSavingCod(false);
    }
  };

  const saveExternal = async () => {
    setSavingExternal(true);
    try {
      const res = await updateExternalFraudSettings(external);
      if (res.success) toast.success("External fraud check settings saved");
      else toast.error(res.error || "Failed to save external check settings");
    } catch (e: any) {
      toast.error(e.message || "An error occurred");
    } finally {
      setSavingExternal(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-border shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-amber-500" />
            COD Fraud Shield
          </CardTitle>
          <CardDescription>
            Internal risk scoring for Cash on Delivery orders, based on the
            customer&apos;s account AND phone-number history. High risk is
            flagged and OTP-verified — never hard-blocked.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ToggleField
            label="Fraud shield enabled"
            description="When off, every COD order scores LOW and no OTP is requested."
            checked={cod.enabled}
            onChange={(v) => setCod({ ...cod, enabled: v })}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              label="High-value COD threshold (৳)"
              value={cod.cod_high_value_threshold}
              onChange={(v) => setCod({ ...cod, cod_high_value_threshold: v })}
              hint="Orders above this value score risk points."
            />
            <NumberField
              label="High-risk score threshold"
              value={cod.max_cod_risk_score}
              onChange={(v) => setCod({ ...cod, max_cod_risk_score: v })}
              hint="Score at or above this is classified HIGH risk."
            />
            <NumberField
              label="OTP expiry (minutes)"
              value={cod.otp_expiry_minutes}
              onChange={(v) => setCod({ ...cod, otp_expiry_minutes: v })}
            />
            <NumberField
              label="OTP max attempts"
              value={cod.otp_max_attempts}
              onChange={(v) => setCod({ ...cod, otp_max_attempts: v })}
            />
            <NumberField
              label="OTP resend cooldown (seconds)"
              value={cod.otp_resend_cooldown_seconds}
              onChange={(v) => setCod({ ...cod, otp_resend_cooldown_seconds: v })}
            />
            <NumberField
              label="Duplicate order window (minutes)"
              value={cod.duplicate_order_window_minutes}
              onChange={(v) =>
                setCod({ ...cod, duplicate_order_window_minutes: v })
              }
              hint="Another order from the same history inside this window scores risk points."
            />
          </div>
          <ToggleField
            label="OTP required for high-value COD"
            checked={cod.otp_required_for_high_value}
            onChange={(v) => setCod({ ...cod, otp_required_for_high_value: v })}
          />
          <ToggleField
            label="OTP required for first-time customers"
            checked={cod.otp_required_for_first_order}
            onChange={(v) => setCod({ ...cod, otp_required_for_first_order: v })}
          />
        </CardContent>
        <CardFooter>
          <Button onClick={saveCod} disabled={savingCod}>
            {savingCod && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save COD Shield Settings
          </Button>
        </CardFooter>
      </Card>

      <Card className="border-border shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PhoneCall className="h-5 w-5 text-sky-600" />
            External Fraud Check (BDCourier)
          </CardTitle>
          <CardDescription>
            Checks the customer&apos;s phone number against BDCourier&apos;s
            cross-courier delivery history when an order is placed, and shows
            the result on the admin order page. Requires the store&apos;s own
            BDCourier API key — until one is saved, orders record
            &quot;not configured&quot; and checkout is unaffected.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ToggleField
            label="External check enabled"
            description="Runs on order placement and stores the result on the order."
            checked={external.enabled}
            onChange={(v) => setExternal({ ...external, enabled: v })}
          />
          <div className="space-y-1.5">
            <Label>BDCourier API key</Label>
            <Input
              type="password"
              autoComplete="off"
              placeholder="Paste the store's BDCourier API key"
              value={external.api_key}
              onChange={(e) =>
                setExternal({ ...external, api_key: e.target.value })
              }
            />
            <p className="text-xs text-muted-foreground">
              Stored in the fraud settings row and used server-side only.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              label="Warn when success ratio below (%)"
              value={external.success_ratio_warn_below}
              onChange={(v) =>
                setExternal({ ...external, success_ratio_warn_below: v })
              }
            />
            <NumberField
              label="Request timeout (ms)"
              value={external.timeout_ms}
              onChange={(v) => setExternal({ ...external, timeout_ms: v })}
            />
          </div>
        </CardContent>
        <CardFooter>
          <Button onClick={saveExternal} disabled={savingExternal}>
            {savingExternal && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save External Check Settings
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
