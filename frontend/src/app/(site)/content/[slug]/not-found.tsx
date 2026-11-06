import { BookX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/display";
import { Link } from "@/components/ui/link";
import { getT } from "@/lib/server";

export default async function NotFound() {
  const t = await getT();
  return <div className="mx-auto max-w-md px-4 pt-16"><EmptyState icon={BookX} title={t.lesson.notAvailable} text={t.lesson.notAvailableText} action={<Button asChild><Link href="/explore">{t.common.browse}</Link></Button>} /></div>;
}
