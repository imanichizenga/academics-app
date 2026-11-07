import { notFound } from "next/navigation";
import { Settings } from "@/components/admin/settings";

export const metadata = { title: "Settings" };
export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!["general", "announcements", "payments", "storage", "engagement", "notifications", "admins"].includes(section)) notFound();
  return <Settings section={section} />;
}
