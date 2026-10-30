import { ReactNode } from "react";
import {
  requireManagerSection,
  MANAGER_OR_MARKETING_ROLES,
} from "@/lib/security/manager-sections";

// S3-3: CMS inside /manager is a manager/marketing surface (same rule as
// the sidebar) — SUPPORT and other staff bounce to /manager.
export default async function ManagerCmsLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireManagerSection(MANAGER_OR_MARKETING_ROLES, "/manager/cms");
  return <>{children}</>;
}
