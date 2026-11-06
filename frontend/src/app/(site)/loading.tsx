import { GridSkeleton } from "@/components/content/card";
import { Skeleton } from "@/components/ui/display";

export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 md:px-6 md:pt-16">
      <Skeleton className="h-12 w-3/4 max-w-xl" /><Skeleton className="mt-3 h-5 w-2/3 max-w-md" />
      <div className="mt-10"><GridSkeleton count={4} /></div>
    </div>
  );
}
