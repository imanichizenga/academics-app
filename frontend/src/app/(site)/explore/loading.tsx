import { GridSkeleton } from "@/components/content/card";
import { Skeleton } from "@/components/ui/display";

export default function Loading() {
  return <div className="mx-auto max-w-6xl px-4 pt-5 md:px-6 md:pt-8"><Skeleton className="mb-3 h-8 w-32" /><Skeleton className="mb-5 h-11 w-full" /><GridSkeleton /></div>;
}
