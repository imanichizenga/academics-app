import type { ReactNode } from "react";
import { SiteChrome } from "@/components/site/chrome";

/** Sign-in and payment return pages. Never hidden by maintenance mode, or the teacher could not get in. */
export default function OpenLayout({ children }: { children: ReactNode }) {
  return <SiteChrome>{children}</SiteChrome>;
}
