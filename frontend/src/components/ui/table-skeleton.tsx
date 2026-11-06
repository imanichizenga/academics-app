import { Skeleton } from "./display";

export function TableSkeleton({ title = true }: { title?: boolean }) {
  return (
    <div className="space-y-4">
      {title && <div className="flex items-center justify-between"><Skeleton className="h-8 w-40" /><Skeleton className="h-10 w-32" /></div>}
      <div className="flex gap-2"><Skeleton className="h-10 w-64" /><Skeleton className="h-10 w-28" /><Skeleton className="h-10 w-28" /></div>
      <div className="overflow-hidden rounded-xl border bg-surface">{Array.from({ length: 8 }, (_, i) => <div key={i} className="flex items-center gap-4 border-b p-3 last:border-0"><Skeleton className="size-9 shrink-0" /><Skeleton className="h-4 flex-1" /><Skeleton className="hidden h-4 w-20 md:block" /><Skeleton className="h-4 w-16" /></div>)}</div>
    </div>
  );
}
