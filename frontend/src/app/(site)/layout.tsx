import type { ReactNode } from "react";
import { CheckoutProvider } from "@/components/content/checkout";
import { BottomTabs, SessionBanners, SiteFooter, SiteHeader } from "@/components/site/shell";
import { getSite } from "@/lib/server";

export default async function SiteLayout({ children }: { children: ReactNode }) {
  const site = await getSite();
  if (site.maintenance_mode) {
    return <main className="grid min-h-dvh place-items-center p-6 text-center"><div><h1 className="text-2xl font-semibold tracking-tight">We will be right back</h1><p className="mt-2 text-fg-2">{site.site_name} is down for maintenance.</p></div></main>;
  }
  return (
    <CheckoutProvider>
      <SessionBanners />
      <SiteHeader />
      <main id="main" className="min-h-[70dvh]">{children}</main>
      <SiteFooter />
      <BottomTabs />
    </CheckoutProvider>
  );
}
