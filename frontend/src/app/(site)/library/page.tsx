import type { Metadata } from "next";
import { getT } from "@/lib/server";
import { Library } from "@/components/site/library";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.nav.myLearning, robots: { index: false } };
}
export default function LibraryPage() { return <Library />; }
