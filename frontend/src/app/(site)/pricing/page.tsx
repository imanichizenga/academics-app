import type { Metadata } from "next";
import { PricingClient } from "@/components/site/pricing";

export const metadata: Metadata = { title: "Pricing", description: "Simple plans that unlock every lesson." };
export default function PricingPage() { return <PricingClient />; }
