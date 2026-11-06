import type { MetadataRoute } from "next";
import { serverGet } from "@/lib/server";

const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const data = await serverGet<{ contents: { slug: string; updated_at: string }[]; categories: string[] }>("/catalog/sitemap/", 300);
  return [
    { url: origin }, { url: `${origin}/explore` }, { url: `${origin}/pricing` },
    ...(data?.categories ?? []).map((slug) => ({ url: `${origin}/explore?category=${slug}` })),
    ...(data?.contents ?? []).map((c) => ({ url: `${origin}/content/${c.slug}`, lastModified: c.updated_at })),
  ];
}
