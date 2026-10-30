"use client";

import { useState, useTransition } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  updateInvoiceInfo,
  type InvoiceInfo,
} from "@/lib/actions/settings.actions";
import { Save, FileText, Loader2 } from "lucide-react";

const FIELDS: {
  key: keyof InvoiceInfo;
  label: string;
  hint: string;
  multiline?: boolean;
}[] = [
  {
    key: "company_name",
    label: "Company Name",
    hint: "Printed at the top of every invoice (Mushak-6.3 header).",
  },
  {
    key: "central_bin",
    label: "Central BIN",
    hint: "NBR-issued Business Identification Number shown under the company name.",
  },
  {
    key: "central_address",
    label: "Central Address",
    hint: "Registered central address printed on the invoice header.",
    multiline: true,
  },
  {
    key: "web_address",
    label: "Web Address",
    hint: "Shown in the invoice footer contact block.",
  },
  // REG-29: "Customer Care Phone" and "Contact Email" are NOT edited
  // here anymore — they are canonical in General Settings (store_info)
  // and the invoice reads them from there, so the invoice footer can
  // never drift from the storefront header again.
  {
    key: "shop_concern",
    label: "Shop Concern Phone",
    hint: "Second contact number printed in the invoice footer.",
  },
  {
    key: "system_by",
    label: "System By",
    hint: "Attribution line at the bottom of the invoice.",
  },
];

export function InvoiceSettingsClient({
  initialInfo,
}: {
  initialInfo: InvoiceInfo;
}) {
  const [info, setInfo] = useState<InvoiceInfo>({ ...initialInfo });
  const [isPending, startTransition] = useTransition();

  const handleSave = () => {
    startTransition(async () => {
      const result = await updateInvoiceInfo(info);
      if (result.success) {
        toast.success("Invoice & company information saved!");
      } else {
        toast.error(result.error ?? "Failed to save invoice settings.");
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2">
            <FileText className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle>Invoice & Company Information</CardTitle>
            <CardDescription>
              These details are printed on every customer invoice — the admin
              print view, the customer invoice, the public invoice link and the
              delivered-order email. Changes apply to newly rendered invoices
              immediately. The invoice&apos;s contact email and customer-care
              phone come from General Settings, so they always match the
              storefront header.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {FIELDS.map((field) => (
            <div
              key={field.key}
              className={field.multiline ? "space-y-1.5 md:col-span-2" : "space-y-1.5"}
            >
              <Label htmlFor={`invoice-${field.key}`}>{field.label}</Label>
              {field.multiline ? (
                <Textarea
                  id={`invoice-${field.key}`}
                  value={info[field.key]}
                  onChange={(e) =>
                    setInfo({ ...info, [field.key]: e.target.value })
                  }
                  rows={2}
                />
              ) : (
                <Input
                  id={`invoice-${field.key}`}
                  value={info[field.key]}
                  onChange={(e) =>
                    setInfo({ ...info, [field.key]: e.target.value })
                  }
                />
              )}
              <p className="text-xs text-muted-foreground">{field.hint}</p>
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            {isPending ? "Saving..." : "Save Invoice Info"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
