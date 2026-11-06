import { BookX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/display";
import { Link } from "@/components/ui/link";

export default function NotFound() {
  return <div className="mx-auto max-w-md px-4 pt-16"><EmptyState icon={BookX} title="This lesson is not available" text="It may have been moved or unpublished." action={<Button asChild><Link href="/explore">Browse lessons</Link></Button>} /></div>;
}
