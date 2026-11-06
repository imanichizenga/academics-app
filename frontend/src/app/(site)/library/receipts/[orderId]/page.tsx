import type { Metadata } from "next";
import { getT } from "@/lib/server";
import { ReceiptView } from "@/components/site/receipt";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.receipt.title, robots: { index: false } };
}
export default async function ReceiptPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  return <ReceiptView id={orderId} />;
}
