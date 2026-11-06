import type { Metadata } from "next";
import { Library } from "@/components/site/library";

export const metadata: Metadata = { title: "My learning", robots: { index: false } };
export default function LibraryPage() { return <Library />; }
