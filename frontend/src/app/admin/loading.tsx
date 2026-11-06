import { Skeleton } from "@/components/ui/display";

export default function Loading() {
  return <div className="space-y-4"><Skeleton className="h-8 w-48" /><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}</div><Skeleton className="h-72" /></div>;
}
