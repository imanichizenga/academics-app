import type { ReactNode } from "react";
import { CheckoutProvider } from "@/components/content/checkout";
import { BottomTabs, SessionBanners, SiteFooter, SiteHeader } from "./shell";

export function SiteChrome({ children }: { children: ReactNode }) {
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
