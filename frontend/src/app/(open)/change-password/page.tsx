import type { Metadata } from "next";
import { getT } from "@/lib/server";
import { Suspense } from "react";
import { ChangePassword } from "@/components/site/auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.auth.changePassword, robots: { index: false } };
}
export default function Page() { return <Suspense><ChangePassword /></Suspense>; }
