import type { Metadata } from "next";
import { getT } from "@/lib/server";
import { Signup } from "@/components/site/auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.auth.createTitle, robots: { index: false } };
}
export default function SignupPage() { return <Signup />; }
