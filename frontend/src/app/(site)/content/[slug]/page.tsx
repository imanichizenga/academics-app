import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContentDetail } from "@/components/content/detail";
import { getSite, serverGet } from "@/lib/server";
import type { Card, Detail } from "@/lib/types";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const item = await serverGet<Detail>(`/catalog/contents/${slug}/`);
  if (!item) return { title: "Not found" };
  return {
    title: item.seo_title, description: item.seo_description,
    alternates: { canonical: `/content/${slug}` },
    openGraph: { title: item.seo_title, description: item.seo_description, type: "article", publishedTime: item.published_at, images: item.cover_full_url ? [item.cover_full_url] : [] },
    twitter: { card: "summary_large_image", title: item.seo_title, description: item.seo_description },
  };
}

export default async function ContentPage({ params }: Props) {
  const { slug } = await params;
  const [item, related, site] = await Promise.all([serverGet<Detail>(`/catalog/contents/${slug}/`), serverGet<Card[]>(`/catalog/contents/${slug}/related/`, 120), getSite()]);
  if (!item) notFound();
  const jsonLd = {
    "@context": "https://schema.org", "@type": item.content_type === "video" ? "VideoObject" : "Article", headline: item.title, name: item.title, description: item.seo_description,
    image: item.cover_full_url || undefined, thumbnailUrl: item.cover_full_url || undefined, uploadDate: item.content_type === "video" ? item.published_at : undefined, datePublished: item.published_at, dateModified: item.updated_at,
    author: { "@type": "Person", name: item.author?.name }, publisher: { "@type": "Organization", name: site.site_name },
    isAccessibleForFree: item.access_level === "free", ...(item.access_level === "paid" ? { hasPart: { "@type": "WebPageElement", isAccessibleForFree: false, cssSelector: "[data-testid=paywall]" } } : {}),
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <ContentDetail initial={item} related={related ?? []} />
    </>
  );
}
