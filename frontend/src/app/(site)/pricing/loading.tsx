import { Skeleton } from "@/components/ui/display";

export default function Loading() {
  return <div className="mx-auto max-w-5xl px-4 pt-8 md:px-6 md:pt-14"><Skeleton className="mx-auto h-12 w-3/4 max-w-lg" /><div className="mt-10 grid gap-4 md:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-96 rounded-2xl" />)}</div></div>;
}
