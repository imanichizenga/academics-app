import type { Metadata, Viewport } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { AppLoader } from "@/components/ui/app-loader";
import { RouteProgress } from "@/components/ui/route-progress";
import { Providers } from "@/lib/providers";
import { getSite } from "@/lib/server";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const serif = Source_Serif_4({ subsets: ["latin"], variable: "--font-serif-4", display: "swap" });
const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSite();
  return {
    metadataBase: new URL(origin),
    title: { default: site.seo_title || site.site_name, template: `%s · ${site.site_name}` },
    description: site.seo_description || site.tagline,
    manifest: "/manifest.webmanifest",
    icons: { icon: site.favicon_url || "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
    appleWebApp: { capable: true, title: site.site_name, statusBarStyle: "default" },
    openGraph: { siteName: site.site_name, type: "website" },
  };
}
export const viewport: Viewport = {
  width: "device-width", initialScale: 1, viewportFit: "cover",
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#fafaf9" }, { media: "(prefers-color-scheme: dark)", color: "#0c0c0e" }],
};

/** White or near-black text on the admin's chosen brand colour, whichever reads better. */
function readableOn(hex: string) {
  const v = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.05 ? "#ffffff" : "#111113";
}
const THEME_SCRIPT = `try{var t=localStorage.getItem("theme");if(t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection(); // render per request, while fetches stay in the data cache for ISR-style freshness
  const site = await getSite();
  const color = /^#[0-9a-fA-F]{6}$/.test(site.primary_color) ? site.primary_color : "#4F46E5";
  return (
    <html lang="en" className={`${inter.variable} ${serif.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <style dangerouslySetInnerHTML={{ __html: `:root{--primary:${color};--primary-fg:${readableOn(color)}}` }} />
      </head>
      <body>
        <AppLoader name={site.site_name} logo={site.logo_url} />
        <RouteProgress />
        <Providers site={site}>{children}</Providers>
      </body>
    </html>
  );
}
