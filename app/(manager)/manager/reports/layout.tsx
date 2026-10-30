import { ReactNode } from "react";
import {
  requireManagerSection,
  MANAGER_ONLY_ROLES,
} from "@/lib/security/manager-sections";

// S3-3: Reports inside /manager are manager-only (same rule as the
// sidebar) — SUPPORT and other staff bounce to /manager.
export default async function ManagerReportsLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireManagerSection(MANAGER_ONLY_ROLES, "/manager/reports");
  return <>{children}</>;
}
