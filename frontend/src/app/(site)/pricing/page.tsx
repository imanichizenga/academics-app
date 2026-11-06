import type { Metadata } from "next";
import { getT } from "@/lib/server";
import { PricingClient } from "@/components/site/pricing";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.nav.pricing, description: "Simple plans that unlock every lesson." };
}
export default function PricingPage() { return <PricingClient />; }
