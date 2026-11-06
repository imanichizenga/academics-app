import type { Metadata } from "next";
import { getT } from "@/lib/server";
import { Suspense } from "react";
import { Login } from "@/components/site/auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.common.logIn, robots: { index: false } };
}
export default function LoginPage() { return <Suspense><Login /></Suspense>; }
