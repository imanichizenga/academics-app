"use client";
import { ArrowDown, ArrowUp, Columns3, Search, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Dropdown, DropdownContent, DropdownTrigger, EmptyState, Pagination, Skeleton } from "./display";
import { Checkbox, Input } from "./form";

export type Column<T> = { key: string; header: string; cell: (row: T) => ReactNode; sortable?: boolean; className?: string; mobile?: boolean; hiddenByDefault?: boolean };
type Props<T> = {
  columns: Column<T>[]; rows: T[]; rowId: (row: T) => string; loading?: boolean; total?: number; page: number; totalPages: number; onPage: (p: number) => void;
  search?: string; onSearch?: (v: string) => void; searchPlaceholder?: string; ordering?: string; onOrdering?: (v: string) => void; filters?: ReactNode;
  bulkActions?: (ids: string[], clear: () => void) => ReactNode; empty: { icon: LucideIcon; title: string; text: string; action?: ReactNode }; onRowClick?: (row: T) => void; toolbar?: ReactNode;
};

export function useDebounced<T>(value: T, ms = 300) {
  const [debounced, set] = useState(value);
  useEffect(() => { const t = setTimeout(() => set(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return debounced;
}

/** Tables on desktop, stacked rows on phones: same data, never a horizontal scroll on the page. */
export function DataTable<T>({ columns, rows, rowId, loading, total, page, totalPages, onPage, search, onSearch, searchPlaceholder, ordering, onOrdering, filters, bulkActions, empty, onRowClick, toolbar }: Props<T>) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(columns.filter((c) => c.hiddenByDefault).map((c) => c.key)));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [term, setTerm] = useState(search ?? "");
  const debounced = useDebounced(term);
  useEffect(() => { if (onSearch && debounced !== (search ?? "")) onSearch(debounced); }, [debounced]); // eslint-disable-line
  const visible = useMemo(() => columns.filter((c) => !hidden.has(c.key)), [columns, hidden]);
  const ids = rows.map(rowId);
  const allChecked = ids.length > 0 && ids.every((id) => selected.has(id));
  const toggle = (id: string, on: boolean) => setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const sort = (key: string) => onOrdering?.(ordering === key ? `-${key}` : ordering === `-${key}` ? "" : key);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {onSearch && (
          <div className="relative min-w-[200px] flex-1 md:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" aria-hidden />
            <Input aria-label="Search" className="pl-9" placeholder={searchPlaceholder ?? "Search"} value={term} onChange={(e) => setTerm(e.target.value)} />
          </div>
        )}
        {filters}
        <div className="ml-auto flex items-center gap-2">
          {toolbar}
          <Dropdown>
            <DropdownTrigger asChild><Button variant="secondary" size="icon" aria-label="Choose columns" className="hidden md:inline-flex"><Columns3 /></Button></DropdownTrigger>
            <DropdownContent>
              {columns.map((c) => (
                <label key={c.key} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-surface-2">
                  <Checkbox label={c.header} checked={!hidden.has(c.key)} onChange={(on) => setHidden((h) => { const n = new Set(h); if (on) n.delete(c.key); else n.add(c.key); return n; })} />
                  {c.header}
                </label>
              ))}
            </DropdownContent>
          </Dropdown>
        </div>
      </div>
      {selected.size > 0 && bulkActions && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-primary-soft px-3 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          {bulkActions([...selected], () => setSelected(new Set()))}
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}
      {!loading && rows.length === 0 ? <EmptyState {...empty} /> : (
        <div className="overflow-hidden rounded-xl border bg-surface shadow-sm">
          <table className="hidden w-full text-sm md:table">
            <thead>
              <tr className="border-b bg-surface-2/50 text-left text-[13px] text-fg-2">
                {bulkActions && <th className="w-10 pl-4"><Checkbox label="Select all" checked={allChecked} onChange={(on) => setSelected(on ? new Set(ids) : new Set())} /></th>}
                {visible.map((c) => (
                  <th key={c.key} className={cn("h-10 px-3 font-medium", c.className)} aria-sort={ordering === c.key ? "ascending" : ordering === `-${c.key}` ? "descending" : undefined}>
                    {c.sortable ? (
                      <button className="inline-flex items-center gap-1 hover:text-fg" onClick={() => sort(c.key)}>
                        {c.header}{ordering === c.key && <ArrowUp className="size-3.5" />}{ordering === `-${c.key}` && <ArrowDown className="size-3.5" />}
                      </button>
                    ) : c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? Array.from({ length: 8 }, (_, i) => (
                <tr key={i} className="border-b last:border-0">
                  {bulkActions && <td />}
                  {visible.map((c) => <td key={c.key} className="h-[52px] px-3"><Skeleton className="h-4 w-4/5" /></td>)}
                </tr>
              )) : rows.map((row) => (
                <tr key={rowId(row)} onClick={() => onRowClick?.(row)} className={cn("border-b last:border-0", onRowClick && "cursor-pointer hover:bg-surface-2/60", selected.has(rowId(row)) && "bg-primary-soft/50")}>
                  {bulkActions && <td className="pl-4" onClick={(e) => e.stopPropagation()}><Checkbox label="Select row" checked={selected.has(rowId(row))} onChange={(on) => toggle(rowId(row), on)} /></td>}
                  {visible.map((c) => <td key={c.key} className={cn("h-[52px] px-3 py-2", c.className)}>{c.cell(row)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="divide-y md:hidden">
            {loading ? Array.from({ length: 6 }, (_, i) => <li key={i} className="p-4"><Skeleton className="h-4 w-3/4" /><Skeleton className="mt-2 h-3 w-1/2" /></li>)
              : rows.map((row) => (
                <li key={rowId(row)} onClick={() => onRowClick?.(row)} className={cn("flex gap-3 p-4", onRowClick && "cursor-pointer active:bg-surface-2")}>
                  {bulkActions && <span className="pt-0.5" onClick={(e) => e.stopPropagation()}><Checkbox label="Select row" checked={selected.has(rowId(row))} onChange={(on) => toggle(rowId(row), on)} /></span>}
                  <div className="min-w-0 flex-1 space-y-1.5 text-sm">
                    {columns.filter((c) => c.mobile !== false && !c.hiddenByDefault).map((c, i) => (
                      <div key={c.key} className={cn("flex min-w-0 items-center justify-between gap-3", i > 0 && "text-[13px] text-fg-2")}>
                        {i > 0 && <span className="shrink-0 text-fg-3">{c.header}</span>}
                        <div className={cn("min-w-0", i === 0 && "flex-1")}>{c.cell(row)}</div>
                      </div>
                    ))}
                  </div>
                </li>
              ))}
          </ul>
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-fg-3">{total != null ? `${total.toLocaleString()} total` : ""}</span>
        <Pagination page={page} totalPages={totalPages} onChange={onPage} />
      </div>
    </div>
  );
}
