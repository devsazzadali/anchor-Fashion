import { ReactNode } from "react";
import {
  requireManagerSection,
  MANAGER_ONLY_ROLES,
} from "@/lib/security/manager-sections";

// S3-3: Settings inside /manager are manager-only (same rule as the
// sidebar) — SUPPORT and other staff bounce to /manager.
export default async function ManagerSettingsLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireManagerSection(MANAGER_ONLY_ROLES, "/manager/settings");
  return <>{children}</>;
}
