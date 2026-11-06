import type { Metadata } from "next";
import { Suspense } from "react";
import { Explore } from "@/components/site/explore";
import { GridSkeleton } from "@/components/content/card";
import { serverGet } from "@/lib/server";
import type { CategoryNode, Tag } from "@/lib/types";

export const metadata: Metadata = { title: "Explore", description: "Browse lessons by subject, type and price." };

export default async function ExplorePage() {
  const [categories, tags] = await Promise.all([serverGet<CategoryNode[]>("/catalog/categories/", 60), serverGet<Tag[]>("/catalog/tags/", 60)]);
  return <Suspense fallback={<div className="mx-auto max-w-6xl px-4 pt-6"><GridSkeleton /></div>}><Explore categories={categories ?? []} tags={tags ?? []} /></Suspense>;
}
