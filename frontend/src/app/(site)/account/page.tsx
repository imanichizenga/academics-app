import type { Metadata } from "next";
import { getT } from "@/lib/server";
import { Account } from "@/components/site/auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.nav.account, robots: { index: false } };
}
export default function AccountPage() { return <Account />; }
