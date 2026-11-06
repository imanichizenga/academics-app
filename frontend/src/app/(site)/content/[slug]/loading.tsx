import { Skeleton } from "@/components/ui/display";

export default function Loading() {
  return (
    <div className="measure mx-auto px-4 pt-5 md:px-0 md:pt-10">
      <Skeleton className="h-4 w-40" /><Skeleton className="mt-3 h-10 w-11/12" /><Skeleton className="mt-2 h-6 w-3/4" />
      <Skeleton className="mt-6 h-12 w-full" /><Skeleton className="mt-6 aspect-video w-full rounded-xl" />
      <div className="mt-6 space-y-3">{[100, 96, 88, 94, 70].map((w) => <div key={w} style={{ width: `${w}%` }}><Skeleton className="h-4" /></div>)}</div>
    </div>
  );
}
