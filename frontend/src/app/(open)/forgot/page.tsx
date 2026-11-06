import type { Metadata } from "next";
import { getT } from "@/lib/server";
import { Forgot } from "@/components/site/auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.auth.forgotTitle, robots: { index: false } };
}
export default function ForgotPage() { return <Forgot />; }
