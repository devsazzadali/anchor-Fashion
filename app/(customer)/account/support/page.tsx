import { Metadata } from "next";
import { fetchTicketsAction } from "@/app/actions/customer.actions";
import { TicketsList } from "@/components/customer/TicketsList";
import { createDbClient } from "@/lib/db/client";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Support Tickets | Anchor Fashion",
  description: "Manage your support tickets.",
};

export default async function SupportPage() {
  const db = await createDbClient();
  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    redirect("/auth/login?redirect=/account/support");
  }

  const res = await fetchTicketsAction();
  const tickets = res.success && res.data ? res.data : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Support Tickets</h1>
        <p className="mt-2 text-muted-foreground">
          View and manage your support inquiries.
        </p>
      </div>

      <TicketsList initialTickets={tickets} />
    </div>
  );
}
