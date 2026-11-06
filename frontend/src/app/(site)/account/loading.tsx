import { Skeleton } from "@/components/ui/display";

export default function Loading() {
  return <div className="mx-auto max-w-xl space-y-4 px-4 pt-5 md:pt-8"><Skeleton className="h-9 w-36" /><Skeleton className="h-72" /><Skeleton className="h-48" /></div>;
}
