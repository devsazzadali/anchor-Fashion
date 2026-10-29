import { Metadata } from "next";
import { CustomerService } from "@/lib/services/customer.service";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { createDbClient } from "@/lib/db/client";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Notifications | Anchor Fashion",
  description: "View your notifications.",
};

export default async function NotificationsPage() {
  const db = await createDbClient();
  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const customerService = new CustomerService();
  const notifications = await customerService.getNotifications(user.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
        <p className="text-muted-foreground">
          Stay updated with your orders and promotions.
        </p>
      </div>
      <NotificationCenter notifications={notifications} />
    </div>
  );
}
