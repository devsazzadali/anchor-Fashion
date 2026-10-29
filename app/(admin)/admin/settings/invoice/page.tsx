import { Metadata } from "next";
import { getInvoiceInfo } from "@/lib/actions/settings.actions";
import { InvoiceSettingsClient } from "./InvoiceSettingsClient";

export const metadata: Metadata = {
  title: "Invoice & Company Settings | Admin",
};

export const revalidate = 0;

export default async function InvoiceSettingsPage() {
  const invoiceInfo = await getInvoiceInfo();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Invoice & Company
        </h1>
        <p className="mt-1 text-muted-foreground">
          Manage the company identity printed on customer invoices — name,
          BIN, address and contact details.
        </p>
      </div>
      <InvoiceSettingsClient initialInfo={invoiceInfo} />
    </div>
  );
}
