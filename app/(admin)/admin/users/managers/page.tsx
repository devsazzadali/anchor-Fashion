import { UsersTable } from "@/features/admin/components/UsersTable";
import { getUsersByRoleAction } from "@/lib/actions/users.actions";
import { AlertTriangle } from "lucide-react";

export const metadata = {
  title: "Managers | Anchor Fashion",
};

export default async function ManagersPage() {
  const { data: users, error, success } = await getUsersByRoleAction(["MANAGER", "FINANCE_MANAGER", "MARKETING_MANAGER", "WAREHOUSE_MANAGER"]);

  if (!success) {
    return (
      <div className="p-8 pt-6">
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-4 text-destructive">
          <AlertTriangle className="h-5 w-5" />
          <p>Error loading users: {error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 pt-6">
      <UsersTable
        title="Managers"
        description="Manage store managers and department leads across operations, warehouse, finance, and marketing."
        users={users || []}
        allowedRoles={["MANAGER", "FINANCE_MANAGER", "MARKETING_MANAGER", "WAREHOUSE_MANAGER"]}
        defaultRole="MANAGER"
      />
    </div>
  );
}
