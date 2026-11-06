import { CheckCircle2, Eye, FileText, Headphones, Layers, Lock, Newspaper, Play } from "lucide-react";
import { Badge, ProgressBar, Skeleton } from "@/components/ui/display";
import { Link } from "@/components/ui/link";
import type { Card } from "@/lib/types";
import { cn, contentTypeLabel, duration, money } from "@/lib/utils";

export const TYPE_ICON = { article: Newspaper, document: FileText, video: Play, audio: Headphones, mixed: Layers } as const;

export function AccessBadge({ item }: { item: Pick<Card, "access_level" | "has_access" | "effective_price"> }) {
  if (item.access_level === "free") return <Badge tone="success">Free</Badge>;
  if (item.has_access) return <Badge tone="primary"><CheckCircle2 />Unlocked</Badge>;
  return <Badge tone="solid"><Lock />{item.effective_price ? money(item.effective_price) : "Subscribers"}</Badge>;
}
export function metaLine(item: Card) {
  if (item.duration) return duration(item.duration);
  if (item.page_count) return `${item.page_count} pages`;
  return item.reading_time ? `${item.reading_time} min read` : "";
}
export function ContentCard({ item, className, priority }: { item: Card; className?: string; priority?: boolean }) {
  const Icon = TYPE_ICON[item.content_type as keyof typeof TYPE_ICON] ?? Newspaper;
  return (
    <Link href={`/content/${item.slug}`} spinner="overlay" data-testid="content-card"
      className={cn("group flex flex-col overflow-hidden rounded-xl border bg-surface shadow-sm hover:shadow-md", className)}>
      <div className="relative aspect-video overflow-hidden bg-surface-2">
        {item.cover_url && <img src={item.cover_url} alt="" loading={priority ? "eager" : "lazy"} className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" />}
        <span className="absolute left-2 top-2 inline-flex h-6 items-center gap-1 rounded-md bg-black/55 px-1.5 text-xs font-medium text-white backdrop-blur-sm">
          <Icon className="size-3" aria-hidden />{contentTypeLabel[item.content_type]}
        </span>
        {item.percent != null && <ProgressBar value={item.percent} className="absolute inset-x-0 bottom-0 h-1 rounded-none" label="Progress" />}
      </div>
      <div className="flex flex-1 flex-col p-3.5">
        {item.category && <div className="mb-1 truncate text-xs font-medium text-fg-3">{item.category.name}</div>}
        <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight">{item.title}</h3>
        {item.subtitle && <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-fg-2">{item.subtitle}</p>}
        <div className="mt-auto flex items-center justify-between gap-2 pt-3 text-xs text-fg-3">
          <span className="flex min-w-0 items-center gap-2 truncate">
            {metaLine(item)}
            {item.show_view_count && item.view_count > 0 && <span className="inline-flex items-center gap-0.5"><Eye className="size-3" aria-hidden />{item.view_count.toLocaleString()}</span>}
          </span>
          <AccessBadge item={item} />
        </div>
      </div>
    </Link>
  );
}
export function CardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border bg-surface">
      <Skeleton className="aspect-video rounded-none" />
      <div className="space-y-2 p-3.5"><Skeleton className="h-3 w-16" /><Skeleton className="h-4 w-11/12" /><Skeleton className="h-3 w-2/3" /><div className="flex justify-between pt-2"><Skeleton className="h-3 w-14" /><Skeleton className="h-5 w-12" /></div></div>
    </div>
  );
}
export const GRID = "grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";
export function GridSkeleton({ count = 8 }: { count?: number }) {
  return <div className={GRID}>{Array.from({ length: count }, (_, i) => <CardSkeleton key={i} />)}</div>;
}
