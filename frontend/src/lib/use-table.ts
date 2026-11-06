"use client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "./api";
import type { Paged } from "./types";

/** Page, search, ordering and filters for every admin table, in one place. */
export function useTable<T>(path: string, initial: Record<string, string> = {}, opts: { refetchInterval?: number } = {}) {
  const [page, setPage] = useState(1);
  const [search, setSearchValue] = useState("");
  const [ordering, setOrdering] = useState("");
  const [filters, setFilters] = useState(initial);
  const params = new URLSearchParams({ page: String(page), page_size: "20" });
  if (search) params.set("search", search);
  if (ordering) params.set("ordering", ordering);
  Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
  const query = useQuery({ queryKey: [path, params.toString()], queryFn: () => api<Paged<T>>(`${path}?${params}`), placeholderData: keepPreviousData, refetchInterval: opts.refetchInterval });
  return {
    query, rows: query.data?.results ?? [], total: query.data?.count, totalPages: query.data?.total_pages ?? 1, page, setPage, search, ordering, setOrdering, filters, params,
    setSearch: (v: string) => { setPage(1); setSearchValue(v); },
    setFilter: (k: string, v: string) => { setPage(1); setFilters((f) => ({ ...f, [k]: v })); },
  };
}
