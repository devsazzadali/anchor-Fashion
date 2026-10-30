import { ReactNode } from "react";
import {
  requireManagerSection,
  MANAGER_OR_MARKETING_ROLES,
} from "@/lib/security/manager-sections";

// S3-3: Marketing inside /manager is a manager/marketing surface (same
// rule as the sidebar) — SUPPORT and other staff bounce to /manager.
export default async function ManagerMarketingLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireManagerSection(MANAGER_OR_MARKETING_ROLES, "/manager/marketing");
  return <>{children}</>;
}
