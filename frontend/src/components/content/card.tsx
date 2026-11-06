"use client";
import { CheckCircle2, Eye, FileText, Headphones, Layers, Lock, Newspaper, Play } from "lucide-react";
import { Badge, ProgressBar, Skeleton } from "@/components/ui/display";
import { Link } from "@/components/ui/link";
import { useT } from "@/lib/providers";
import type { Card } from "@/lib/types";
import { GRID, cn, duration, money } from "@/lib/utils";

export const TYPE_ICON = { article: Newspaper, document: FileText, video: Play, audio: Headphones, mixed: Layers } as const;

export function AccessBadge({ item }: { item: Pick<Card, "access_level" | "has_access" | "effective_price"> }) {
  const { t } = useT();
  if (item.access_level === "free") return <Badge tone="success">{t.card.free}</Badge>;
  if (item.has_access) return <Badge tone="primary"><CheckCircle2 />{t.card.unlocked}</Badge>;
  return <Badge tone="solid"><Lock />{item.effective_price ? money(item.effective_price) : t.card.subscribers}</Badge>;
}
function useMeta(item: Card) {
  const { t } = useT();
  if (item.duration) return duration(item.duration);
  if (item.page_count) return t.card.pages(item.page_count);
  return item.reading_time ? t.card.minRead(item.reading_time) : "";
}
type Variant = "list" | "large";
/** "list" is a compact row below md and a card above it. "large" is always a card, for carousels. */
export function ContentCard({ item, className, priority, variant = "list" }: { item: Card; className?: string; priority?: boolean; variant?: Variant }) {
  const { t } = useT();
  const Icon = TYPE_ICON[item.content_type as keyof typeof TYPE_ICON] ?? Newspaper;
  const meta = useMeta(item);
  const list = variant === "list";
  return (
    <Link href={`/content/${item.slug}`} spinner="overlay" data-testid="content-card" data-variant={variant}
      className={cn("group flex overflow-hidden rounded-xl border bg-surface shadow-sm hover:shadow-md", list ? "gap-3 p-2.5 md:flex-col md:gap-0 md:p-0" : "flex-col", className)}>
      <div className={cn("relative aspect-video overflow-hidden bg-surface-2", list && "w-24 shrink-0 self-start rounded-lg md:w-full md:rounded-none")}>
        {item.cover_url && <img src={item.cover_url} alt="" loading={priority ? "eager" : "lazy"} className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" />}
        <span className={cn("absolute left-2 top-2 h-6 items-center gap-1 rounded-md bg-black/55 px-1.5 text-xs font-medium text-white backdrop-blur-sm", list ? "hidden md:inline-flex" : "inline-flex")}>
          <Icon className="size-3" aria-hidden />{t.types[item.content_type]}
        </span>
        {item.percent != null && <ProgressBar value={item.percent} className="absolute inset-x-0 bottom-0 h-1 rounded-none" label={t.card.progress} />}
      </div>
      <div className={cn("flex min-w-0 flex-1 flex-col", list ? "md:p-3.5" : "p-3.5")}>
        {item.category && <div className="mb-0.5 truncate text-xs font-medium text-fg-3 md:mb-1">{item.category.name}</div>}
        <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight">{item.title}</h3>
        {item.subtitle && <p className={cn("mt-1 line-clamp-2 text-[13px] leading-snug text-fg-2", list && "hidden md:block")}>{item.subtitle}</p>}
        <div className={cn("mt-auto flex items-center justify-between gap-2 text-xs text-fg-3", list ? "pt-1.5 md:pt-3" : "pt-3")}>
          <span className="flex min-w-0 items-center gap-2 truncate">
            {meta}
            {item.show_view_count && item.view_count > 0 && <span className="inline-flex items-center gap-0.5"><Eye className="size-3" aria-hidden />{item.view_count.toLocaleString()}</span>}
          </span>
          <AccessBadge item={item} />
        </div>
      </div>
    </Link>
  );
}
export function CardSkeleton({ variant = "list", className }: { variant?: Variant; className?: string }) {
  const list = variant === "list";
  return (
    <div className={cn("flex overflow-hidden rounded-xl border bg-surface", list ? "gap-3 p-2.5 md:flex-col md:gap-0 md:p-0" : "flex-col", className)}>
      <Skeleton className={cn("aspect-video rounded-none", list && "w-24 shrink-0 self-start rounded-lg md:w-full md:rounded-none")} />
      <div className={cn("min-w-0 flex-1 space-y-2", list ? "md:p-3.5" : "p-3.5")}><Skeleton className="h-3 w-16" /><Skeleton className="h-4 w-11/12" /><Skeleton className="hidden h-3 w-2/3 md:block" /><div className="flex justify-between pt-1 md:pt-2"><Skeleton className="h-3 w-14" /><Skeleton className="h-5 w-12" /></div></div>
    </div>
  );
}
export function GridSkeleton({ count = 8 }: { count?: number }) {
  return <div className={GRID}>{Array.from({ length: count }, (_, i) => <CardSkeleton key={i} />)}</div>;
}
