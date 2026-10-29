import { Metadata } from "next";
import { CustomerService } from "@/lib/services/customer.service";
import { AddressBook } from "@/components/customer/AddressBook";
import { createDbClient } from "@/lib/db/client";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Address Book | Anchor Fashion",
  description: "Manage your addresses.",
};

export default async function AddressesPage() {
  const db = await createDbClient();
  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const customerService = new CustomerService();
  const addresses = await customerService.getAddresses(user.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Address Book</h1>
        <p className="text-muted-foreground">
          Manage your shipping and billing addresses.
        </p>
      </div>
      <AddressBook addresses={addresses} />
    </div>
  );
}
