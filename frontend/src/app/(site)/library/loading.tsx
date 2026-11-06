import { GridSkeleton } from "@/components/content/card";
import { Skeleton } from "@/components/ui/display";

export default function Loading() {
  return <div className="mx-auto max-w-6xl px-4 pt-5 md:px-6 md:pt-8"><Skeleton className="mb-4 h-9 w-44" /><Skeleton className="mb-6 h-20" /><Skeleton className="mb-5 h-11" /><GridSkeleton count={4} /></div>;
}
