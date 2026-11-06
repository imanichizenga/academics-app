"use client";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { BookX, ChevronLeft, ChevronRight, Search, SlidersHorizontal, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { CardSkeleton, ContentCard } from "@/components/content/card";
import { Button } from "@/components/ui/button";
import { useDebounced } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/display";
import { Input, Select } from "@/components/ui/form";
import { Sheet } from "@/components/ui/overlay";
import { api } from "@/lib/api";
import type { Dict } from "@/lib/i18n";
import { useSession, useT } from "@/lib/providers";
import type { Card, CategoryNode, Paged, Tag } from "@/lib/types";
import { GRID, cn } from "@/lib/utils";
import { PullToRefresh } from "./pull-to-refresh";

const TYPES = ["article", "document", "video", "audio"];
const accessOptions = (t: Dict) => [{ value: "", label: t.explore.all }, { value: "free", label: t.explore.free }, { value: "paid", label: t.explore.paid }, { value: "unlocked", label: t.explore.mine }];
const sortOptions = (t: Dict) => [{ value: "newest", label: t.explore.newest }, { value: "popular", label: t.explore.popular }, { value: "liked", label: t.explore.liked }, { value: "price", label: t.explore.priceLow }, { value: "price_desc", label: t.explore.priceHigh }];
type Filters = { q: string; category: string; type: string; access: string; tag: string; sort: string };

const fromParams = (p: URLSearchParams): Filters => ({ q: p.get("q") ?? "", category: p.get("category") ?? "", type: p.get("type") ?? "", access: p.get("access") ?? "", tag: p.get("tag") ?? "", sort: p.get("sort") ?? "newest" });
function toQuery(f: Partial<Filters>) {
  const q = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => { if (v && !(k === "sort" && v === "newest")) q.set(k, v); });
  return q.toString();
}
function Chip({ active, onClick, children, count }: { active?: boolean; onClick: () => void; children: React.ReactNode; count?: number }) {
  return (
    <button onClick={onClick} aria-pressed={active} className={cn("inline-flex h-9 shrink-0 items-center gap-1 rounded-full border px-3 text-[13px] font-medium", active ? "border-primary bg-primary text-primary-fg" : "border-border-strong bg-surface text-fg-2 hover:text-fg")}>
      {children}{count != null && <span className={cn("tabular-nums", active ? "opacity-80" : "text-fg-3")}>{count}</span>}
    </button>
  );
}
function CategoryTree({ categories, value, onPick }: { categories: CategoryNode[]; value: string; onPick: (slug: string) => void }) {
  const { t } = useT();
  const row = (active: boolean) => cn("flex min-h-9 w-full items-center justify-between gap-2 rounded-md px-2.5 text-left text-sm", active ? "bg-primary-soft font-medium text-primary-ink" : "text-fg-2 hover:bg-surface-2 hover:text-fg");
  return (
    <nav aria-label={t.explore.categories} className="space-y-0.5">
      <button className={row(!value)} onClick={() => onPick("")}>{t.explore.allSubjects}</button>
      {categories.map((c) => (
        <div key={c.id}>
          <button className={row(value === c.slug)} onClick={() => onPick(c.slug)}><span>{c.name}</span><span className="text-[13px] tabular-nums text-fg-3">{c.content_count}</span></button>
          {(value === c.slug || c.children.some((k) => k.slug === value)) && <div className="ml-3 mt-0.5 space-y-0.5 border-l pl-2">
            {c.children.map((k) => <button key={k.id} className={row(value === k.slug)} onClick={() => onPick(k.slug)}><span>{k.name}</span><span className="text-[13px] tabular-nums text-fg-3">{k.content_count}</span></button>)}
          </div>}
        </div>
      ))}
    </nav>
  );
}
function FilterFields({ f, set, tags, signedIn }: { f: Filters; set: (p: Partial<Filters>) => void; tags: Tag[]; signedIn: boolean }) {
  const { t } = useT();
  return (
    <div className="space-y-5">
      <fieldset><legend className="mb-2 text-[13px] font-semibold">{t.explore.type}</legend>
        <div className="flex flex-wrap gap-1.5"><Chip active={!f.type} onClick={() => set({ type: "" })}>{t.explore.all}</Chip>{TYPES.map((x) => <Chip key={x} active={f.type === x} onClick={() => set({ type: f.type === x ? "" : x })}>{t.types[x]}</Chip>)}</div>
      </fieldset>
      <fieldset><legend className="mb-2 text-[13px] font-semibold">{t.explore.access}</legend>
        <div className="flex flex-wrap gap-1.5">{accessOptions(t).filter((a) => a.value !== "unlocked" || signedIn).map((a) => <Chip key={a.value} active={f.access === a.value} onClick={() => set({ access: a.value })}>{a.label}</Chip>)}</div>
      </fieldset>
      {tags.length > 0 && <fieldset><legend className="mb-2 text-[13px] font-semibold">{t.explore.tags}</legend>
        <div className="flex flex-wrap gap-1.5">{tags.map((x) => <Chip key={x.id} active={f.tag === x.slug} onClick={() => set({ tag: f.tag === x.slug ? "" : x.slug })}>{x.name}</Chip>)}</div>
      </fieldset>}
    </div>
  );
}

export function Explore({ categories, tags }: { categories: CategoryNode[]; tags: Tag[] }) {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const { user } = useSession();
  const { t } = useT();
  const SORTS = sortOptions(t);
  const ACCESS = accessOptions(t);
  const [, start] = useTransition();
  const filters = useMemo(() => fromParams(params), [params]);
  const [term, setTerm] = useState(filters.q);
  const debounced = useDebounced(term, 300);
  const [sheet, setSheet] = useState(false);
  const [draft, setDraft] = useState(filters);
  const input = useRef<HTMLInputElement>(null);
  const flat = useMemo(() => categories.flatMap((c) => [c, ...c.children]), [categories]);

  const update = useCallback((patch: Partial<Filters>, replace = false) => {
    const next = toQuery({ ...fromParams(new URLSearchParams(location.search)), ...patch });
    const url = next ? `${path}?${next}` : path;
    start(() => (replace ? router.replace(url, { scroll: false }) : router.push(url, { scroll: false })));
  }, [path, router]);
  useEffect(() => { if (debounced !== filters.q) update({ q: debounced }, true); }, [debounced]); // eslint-disable-line
  useEffect(() => { setTerm(filters.q); }, [filters.q]);
  useEffect(() => { if (params.get("focus")) input.current?.focus(); }, [params]);

  const query = useInfiniteQuery({
    queryKey: ["explore", filters], initialPageParam: 1, placeholderData: keepPreviousData,
    queryFn: ({ pageParam }) => api<Paged<Card>>(`/catalog/contents/?${toQuery(filters)}&page=${pageParam}&page_size=12`),
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const draftCount = useQuery({ queryKey: ["explore-count", draft], enabled: sheet, queryFn: () => api<Paged<Card>>(`/catalog/contents/?${toQuery(draft)}&page_size=1`) });
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const observer = new IntersectionObserver(([e]) => { if (e.isIntersecting && query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage(); }, { rootMargin: "400px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [query.hasNextPage, query.isFetchingNextPage, query.fetchNextPage]); // eslint-disable-line

  const rows = query.data?.pages.flatMap((p) => p.results) ?? [];
  const count = query.data?.pages[0]?.count ?? 0;
  const pills: { key: keyof Filters; label: string }[] = [];
  if (filters.q) pills.push({ key: "q", label: `“${filters.q}”` });
  if (filters.category) pills.push({ key: "category", label: flat.find((c) => c.slug === filters.category)?.name ?? filters.category });
  if (filters.type) pills.push({ key: "type", label: t.types[filters.type] ?? filters.type });
  if (filters.access) pills.push({ key: "access", label: ACCESS.find((a) => a.value === filters.access)?.label ?? filters.access });
  if (filters.tag) pills.push({ key: "tag", label: tags.find((x) => x.slug === filters.tag)?.name ?? filters.tag });
  const active = categories.find((c) => c.slug === filters.category || c.children.some((k) => k.slug === filters.category));
  const clearAll = () => { setTerm(""); update({ q: "", category: "", type: "", access: "", tag: "", sort: "newest" }); };
  const refresh = useCallback(() => query.refetch(), [query.refetch]); // eslint-disable-line
  return (
    <PullToRefresh onRefresh={refresh}>
      <div className="pb-tabbar mx-auto max-w-6xl px-4 pt-5 md:px-6 md:pt-8">
        <h1 className="mb-4 text-[26px] font-semibold tracking-tight md:text-3xl">{t.explore.title}</h1>
        <div className="sticky top-[calc(56px+env(safe-area-inset-top,0px))] z-20 -mx-4 bg-bg/90 px-4 py-2 backdrop-blur-lg md:static md:mx-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" aria-hidden />
              <Input ref={input} type="search" aria-label={t.explore.search} placeholder={t.explore.search} className="pl-9" value={term} onChange={(e) => setTerm(e.target.value)} />
            </div>
            <Button variant="secondary" className="md:hidden" onClick={() => { setDraft(filters); setSheet(true); }}>
              <SlidersHorizontal />{t.explore.filters}{pills.length ? ` (${pills.length})` : ""}
            </Button>
            <div className="hidden w-52 md:block"><Select label={t.explore.sortBy} value={filters.sort} onChange={(v) => update({ sort: v })} options={SORTS} /></div>
          </div>
        </div>
        <div className="scroll-x -mx-4 flex gap-1.5 px-4 pb-1 pt-2 md:hidden">
          <Chip active={!filters.category} onClick={() => update({ category: "" })}>{t.explore.all}</Chip>
          {categories.map((c) => <Chip key={c.id} active={active?.id === c.id} count={c.content_count} onClick={() => update({ category: filters.category === c.slug ? "" : c.slug })}>{c.name}</Chip>)}
        </div>
        {active && active.children.length > 0 && (
          <div data-testid="subcategories" className="scroll-x -mx-4 flex gap-1.5 px-4 pb-1 pt-1 md:hidden">
            <Chip onClick={() => update({ category: "" })}><ChevronLeft className="size-3.5" aria-hidden />{t.explore.backToAll}</Chip>
            {active.children.map((c) => <Chip key={c.id} active={filters.category === c.slug} count={c.content_count} onClick={() => update({ category: filters.category === c.slug ? active.slug : c.slug })}>{c.name}</Chip>)}
          </div>
        )}
        {pills.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5" aria-label={t.explore.activeFilters}>
            {pills.map((p) => (
              <button key={p.key} onClick={() => { if (p.key === "q") setTerm(""); update({ [p.key]: "" }); }} className="inline-flex h-8 items-center gap-1 rounded-full bg-primary-soft pl-3 pr-2 text-[13px] font-medium text-primary-ink">
                {p.label}<X className="size-3.5" aria-label={t.explore.remove} />
              </button>
            ))}
            <button onClick={clearAll} className="h-8 px-2 text-[13px] font-medium text-fg-2 underline-offset-2 hover:underline">{t.explore.clearAll}</button>
          </div>
        )}
        <div className="mt-5 md:grid md:grid-cols-[230px_minmax(0,1fr)] md:gap-8">
          <aside className="hidden md:block">
            <div className="sticky top-24 space-y-6">
              <CategoryTree categories={categories} value={filters.category} onPick={(slug) => update({ category: slug })} />
              <FilterFields f={filters} set={update} tags={tags} signedIn={!!user} />
            </div>
          </aside>
          <div>
            <p className="mb-3 text-[13px] text-fg-3" aria-live="polite">{query.isLoading ? t.explore.searching : t.explore.results(count)}</p>
            {query.isLoading ? <div className={GRID.replace("xl:grid-cols-4", "")}>{Array.from({ length: 6 }, (_, i) => <CardSkeleton key={i} />)}</div>
              : rows.length === 0 ? <EmptyState icon={BookX} title={t.explore.noneTitle} text={t.explore.noneText} action={<Button variant="secondary" onClick={clearAll}>{t.explore.clearFilters}</Button>} /> : (
                <div className={cn(GRID.replace("xl:grid-cols-4", ""), query.isPlaceholderData && "opacity-60")}>
                  {rows.map((c, i) => <ContentCard key={c.id} item={c} priority={i < 3} />)}
                  {query.isFetchingNextPage && Array.from({ length: 3 }, (_, i) => <CardSkeleton key={i} />)}
                </div>
              )}
            <div ref={sentinel} aria-hidden className="h-4" />
          </div>
        </div>
      </div>
      <Sheet open={sheet} onOpenChange={setSheet} title={t.explore.filters}
        footer={<div className="flex w-full gap-2"><Button variant="secondary" onClick={() => setDraft({ ...draft, type: "", access: "", tag: "" })}>{t.explore.reset}</Button><Button className="flex-1" onClick={() => { update(draft); setSheet(false); }}>{t.explore.apply(draftCount.data?.count ?? "…")}</Button></div>}>
        <div className="space-y-5">
          <fieldset><legend className="mb-2 text-[13px] font-semibold">{t.explore.sortBy}</legend><Select label={t.explore.sortBy} value={draft.sort} onChange={(v) => setDraft({ ...draft, sort: v })} options={SORTS} /></fieldset>
          <FilterFields f={draft} set={(p) => setDraft({ ...draft, ...p })} tags={tags} signedIn={!!user} />
        </div>
      </Sheet>
    </PullToRefresh>
  );
}
export { ChevronRight };
