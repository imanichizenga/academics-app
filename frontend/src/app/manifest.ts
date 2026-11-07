import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { brandColor, getSite } from "@/lib/server";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  await connection(); // otherwise the build freezes whatever the API said then, or the fallback if it was down
  const site = await getSite();
  return {
    name: site.site_name, short_name: site.site_name, description: site.tagline, start_url: "/", scope: "/", display: "standalone",
    background_color: "#fafaf9", theme_color: brandColor(site), orientation: "portrait-primary",
    icons: [
      { src: site.icons.icon_192, sizes: "192x192", type: "image/png" },
      { src: site.icons.icon_512, sizes: "512x512", type: "image/png" },
      { src: site.icons.maskable_512, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
