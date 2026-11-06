import type { MetadataRoute } from "next";
import { getSite } from "@/lib/server";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const site = await getSite();
  return {
    name: site.site_name, short_name: site.site_name, description: site.tagline, start_url: "/", scope: "/", display: "standalone",
    background_color: "#fafaf9", theme_color: site.primary_color, orientation: "portrait-primary",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
