"use client";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Copy, ExternalLink, MoreHorizontal, Pencil, Plus, Trash2, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Badge, Dropdown, DropdownContent, DropdownItem, DropdownTrigger, PageHeader } from "@/components/ui/display";
import { Field, Input, Select } from "@/components/ui/form";
import { Link } from "@/components/ui/link";
import { ConfirmSheet, Sheet } from "@/components/ui/overlay";
import { api, del, patch, post } from "@/lib/api";
import { useAction } from "@/lib/providers";
import type { CategoryNode } from "@/lib/types";
import { useTable } from "@/lib/use-table";
import { contentTypeLabel, dateLabel, money } from "@/lib/utils";

type Row = { id: string; slug: string; title: string; subtitle: string; cover_url: string; content_type: string; category: { name: string } | null; status: string; access_level: string; price: number | null; view_count: number; updated_at: string; published_at: string | null };
const STATUS = { draft: "neutral", scheduled: "info", published: "success", archived: "warning" } as const;
const KEY = "/admin/contents/";

export function useCategoryOptions() {
  const { data } = useQuery({ queryKey: ["admin-categories"], queryFn: () => api<CategoryNode[]>("/admin/categories/") });
  return { tree: data ?? [], options: (data ?? []).flatMap((c) => [{ value: c.id, label: c.name }, ...c.children.map((k) => ({ value: k.id, label: `${c.name} / ${k.name}` }))]) };
}
function QuickEdit({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const [access, setAccess] = useState("free");
  const [price, setPrice] = useState("");
  const [seen, setSeen] = useState<string | null>(null);
  if (row && seen !== row.id) { setSeen(row.id); setAccess(row.access_level); setPrice(row.price ? String(row.price) : ""); }
  const save = useAction(() => patch(`/admin/contents/${row!.id}/`, { access_level: access, price: price ? Number(price) : null }), { success: "Price updated", invalidate: [[KEY]], onSuccess: onClose });
  return (
    <Sheet open={!!row} onOpenChange={(v) => { if (!v) onClose(); }} title="Quick edit" description={row?.title} size="sm" footer={<Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button>}>
      <div className="space-y-4">
        <Field label="Access"><Select value={access} onChange={setAccess} options={[{ value: "free", label: "Free" }, { value: "paid", label: "Paid" }]} /></Field>
        {access === "paid" && <Field label="Price (TZS)" hint="Minimum 500"><Input type="number" min={500} value={price} onChange={(e) => setPrice(e.target.value)} /></Field>}
      </div>
    </Sheet>
  );
}
export function ContentList() {
  const table = useTable<Row>(KEY);
  const router = useRouter();
  const { options } = useCategoryOptions();
  const [quick, setQuick] = useState<Row | null>(null);
  const [remove, setRemove] = useState<Row | null>(null);
  const [move, setMove] = useState<string[] | null>(null);
  const [target, setTarget] = useState("");
  const bulk = useAction((v: { ids: string[]; action: string; category?: string }) => post("/admin/contents/bulk/", v), { success: (r) => `${r.count} items updated`, invalidate: [[KEY]], onSuccess: () => setMove(null) });
  const duplicate = useAction((id: string) => post(`/admin/contents/${id}/duplicate/`), { success: "Copy created", invalidate: [[KEY]] });
  const destroy = useAction((id: string) => del(`/admin/contents/${id}/`), { success: "Deleted", invalidate: [[KEY]], onSuccess: () => setRemove(null) });
  const columns: Column<Row>[] = [
    { key: "title", header: "Title", sortable: true, cell: (r) => (
      <div className="flex min-w-0 items-center gap-3">
        <div className="hidden h-10 w-16 shrink-0 overflow-hidden rounded-md bg-surface-2 sm:block">{r.cover_url && <img src={r.cover_url} alt="" className="size-full object-cover" loading="lazy" />}</div>
        <div className="min-w-0"><div className="truncate font-medium">{r.title}</div><div className="truncate text-[13px] text-fg-3">{r.category?.name ?? "No category"}</div></div>
      </div>
    ) },
    { key: "status", header: "Status", cell: (r) => <Badge tone={STATUS[r.status as keyof typeof STATUS]}>{r.status}</Badge> },
    { key: "type", header: "Type", mobile: false, cell: (r) => <span className="text-fg-2">{contentTypeLabel[r.content_type]}</span> },
    { key: "price", header: "Access", sortable: true, cell: (r) => (r.access_level === "free" ? <Badge tone="success">Free</Badge> : <span className="tabular-nums">{r.price ? money(r.price) : "Subscribers"}</span>) },
    { key: "view_count", header: "Views", sortable: true, mobile: false, cell: (r) => <span className="tabular-nums text-fg-2">{r.view_count.toLocaleString()}</span> },
    { key: "updated_at", header: "Updated", sortable: true, mobile: false, cell: (r) => <span className="whitespace-nowrap text-fg-2">{dateLabel(r.updated_at)}</span> },
    { key: "actions", header: "", className: "w-12", mobile: false, cell: (r) => (
      <div onClick={(e) => e.stopPropagation()}>
        <Dropdown>
          <DropdownTrigger asChild><IconButton label={`Actions for ${r.title}`} size="icon-sm"><MoreHorizontal /></IconButton></DropdownTrigger>
          <DropdownContent>
            <DropdownItem onSelect={() => router.push(`/admin/contents/${r.id}`)}><Pencil />Edit</DropdownItem>
            <DropdownItem onSelect={() => setQuick(r)}><Zap />Quick edit price</DropdownItem>
            <DropdownItem onSelect={() => duplicate.mutate(r.id)}><Copy />Duplicate</DropdownItem>
            {r.status === "published" && <DropdownItem onSelect={() => window.open(`/content/${r.slug}`, "_blank")}><ExternalLink />View live</DropdownItem>}
            <DropdownItem danger onSelect={() => setRemove(r)}><Trash2 />Delete</DropdownItem>
          </DropdownContent>
        </Dropdown>
      </div>
    ) },
  ];
  return (
    <>
      <PageHeader title="Content" description="Everything your students can read, watch and download." actions={<Button asChild><Link href="/admin/contents/new"><Plus />New content</Link></Button>} />
      <DataTable
        columns={columns} rows={table.rows} rowId={(r) => r.id} loading={table.query.isLoading} total={table.total} page={table.page} totalPages={table.totalPages} onPage={table.setPage}
        search={table.search} onSearch={table.setSearch} searchPlaceholder="Search content" ordering={table.ordering} onOrdering={table.setOrdering} onRowClick={(r) => router.push(`/admin/contents/${r.id}`)}
        filters={<>
          <Select label="Status" className="w-32" placeholder="Status" value={table.filters.status} onChange={(v) => table.setFilter("status", v)} options={[{ value: "", label: "All statuses" }, ...Object.keys(STATUS).map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))]} />
          <Select label="Type" className="w-32" placeholder="Type" value={table.filters.content_type} onChange={(v) => table.setFilter("content_type", v)} options={[{ value: "", label: "All types" }, ...Object.entries(contentTypeLabel).map(([value, label]) => ({ value, label }))]} />
          <Select label="Access" className="w-28" placeholder="Access" value={table.filters.access_level} onChange={(v) => table.setFilter("access_level", v)} options={[{ value: "", label: "All" }, { value: "free", label: "Free" }, { value: "paid", label: "Paid" }]} />
          <Select label="Category" className="w-40" placeholder="Category" value={table.filters.category} onChange={(v) => table.setFilter("category", v)} options={[{ value: "", label: "All categories" }, ...options]} />
        </>}
        bulkActions={(ids, clear) => (<>
          <Button size="sm" variant="secondary" loading={bulk.isPending} onClick={() => bulk.mutate({ ids, action: "publish" }, { onSuccess: clear })}>Publish</Button>
          <Button size="sm" variant="secondary" onClick={() => bulk.mutate({ ids, action: "unpublish" }, { onSuccess: clear })}>Unpublish</Button>
          <Button size="sm" variant="secondary" onClick={() => setMove(ids)}>Move</Button>
          <Button size="sm" variant="secondary" className="text-danger" onClick={() => bulk.mutate({ ids, action: "delete" }, { onSuccess: clear })}>Delete</Button>
        </>)}
        empty={{ icon: BookOpen, title: "No content here", text: "Write your first lesson, or change your filters.", action: <Button asChild><Link href="/admin/contents/new"><Plus />New content</Link></Button> }}
      />
      <QuickEdit row={quick} onClose={() => setQuick(null)} />
      <ConfirmSheet open={!!remove} onOpenChange={(v) => { if (!v) setRemove(null); }} title="Delete this content?" text={`“${remove?.title}” will be gone for good. To keep it for buyers, archive it instead.`} confirmLabel="Delete" danger loading={destroy.isPending} onConfirm={() => destroy.mutate(remove!.id)} />
      <Sheet open={!!move} onOpenChange={(v) => { if (!v) setMove(null); }} title="Move to category" size="sm" footer={<Button disabled={!target} loading={bulk.isPending} onClick={() => bulk.mutate({ ids: move!, action: "move", category: target })}>Move</Button>}>
        <Select label="Category" value={target} onChange={setTarget} options={options} />
      </Sheet>
    </>
  );
}
