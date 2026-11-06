import type { ReactNode } from "react";
import { SiteChrome } from "@/components/site/chrome";
import { MaintenancePage } from "@/components/site/maintenance";
import { getSite, isStaffRequest } from "@/lib/server";

export default async function SiteLayout({ children }: { children: ReactNode }) {
  const site = await getSite();
  if (site.maintenance_mode && !(await isStaffRequest())) return <MaintenancePage />;
  return <SiteChrome>{children}</SiteChrome>;
}
