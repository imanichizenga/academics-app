"use client";
import { DndContext, PointerSensor, TouchSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CornerDownRight, FileClock, FileIcon, FolderTree, GripVertical, ImageIcon, LayoutGrid, List as ListIcon, MessageSquare, MoreHorizontal, Pencil, Pin, Plus, RotateCw, Search, Star, Trash2, Upload } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button, IconButton } from "@/components/ui/button";
import { DataTable, useDebounced, type Column } from "@/components/ui/data-table";
import { Badge, Card, Dropdown, DropdownContent, DropdownItem, DropdownTrigger, EmptyState, PageHeader, Pagination, ProgressBar, Skeleton, Tabs } from "@/components/ui/display";
import { FileDropzone } from "@/components/ui/dropzone";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/form";
import { Link } from "@/components/ui/link";
import { ConfirmSheet, Sheet } from "@/components/ui/overlay";
import { ApiError, api, del, patch, post } from "@/lib/api";
import { useAction } from "@/lib/providers";
import type { CategoryNode, Plan } from "@/lib/types";
import { uploadFile } from "@/lib/upload";
import { useTable } from "@/lib/use-table";
import { cn, dateTime, duration, fileSize, money, timeAgo } from "@/lib/utils";
import { AssetThumb, type PickedAsset } from "./media-picker";

/* ---------- Categories ---------- */
type Editing = Partial<CategoryNode> & { parent?: string | null };
function CategoryRow({ node, depth, onEdit, onDelete, onAddChild }: { node: CategoryNode; depth: number; onEdit: (c: CategoryNode) => void; onDelete: (c: CategoryNode) => void; onAddChild?: (c: CategoryNode) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: node.id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition, marginLeft: depth * 28 }} className={cn("flex min-h-12 items-center gap-2 rounded-lg border bg-surface px-2 shadow-sm", isDragging && "z-10 opacity-80 shadow-lg")}>
      <button type="button" aria-label={`Reorder ${node.name}`} className="grid size-9 cursor-grab touch-none place-items-center text-fg-3" {...attributes} {...listeners}><GripVertical className="size-4" /></button>
      {depth > 0 && <CornerDownRight className="size-3.5 text-fg-3" aria-hidden />}
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: node.color || "var(--primary)" }} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{node.name}{!node.is_active && <span className="ml-2 text-[13px] font-normal text-fg-3">hidden</span>}</span>
      <Badge>{node.content_count}</Badge>
      <Dropdown>
        <DropdownTrigger asChild><IconButton label={`Actions for ${node.name}`} size="icon-sm"><MoreHorizontal /></IconButton></DropdownTrigger>
        <DropdownContent>
          <DropdownItem onSelect={() => onEdit(node)}><Pencil />Edit</DropdownItem>
          {onAddChild && <DropdownItem onSelect={() => onAddChild(node)}><Plus />Add subcategory</DropdownItem>}
          <DropdownItem danger onSelect={() => onDelete(node)}><Trash2 />Delete</DropdownItem>
        </DropdownContent>
      </Dropdown>
    </div>
  );
}
export function Categories() {
  const client = useQueryClient();
  const { data } = useQuery({ queryKey: ["admin-categories"], queryFn: () => api<CategoryNode[]>("/admin/categories/") });
  const [tree, setTree] = useState<CategoryNode[]>([]);
  useEffect(() => { if (data) setTree(data); }, [data]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [removing, setRemoving] = useState<CategoryNode | null>(null);
  const [reassign, setReassign] = useState("");
  const [needsTarget, setNeedsTarget] = useState(false);
  const refresh = () => client.invalidateQueries({ queryKey: ["admin-categories"] });
  const save = useAction(() => (editing!.id ? patch(`/admin/categories/${editing!.id}/`, editing) : post("/admin/categories/", editing)), { success: "Saved", onSuccess: () => { setEditing(null); refresh(); } });
  const remove = useAction(() => del(`/admin/categories/${removing!.id}/${reassign ? `?reassign_to=${reassign}` : ""}`), {
    success: "Category deleted", onSuccess: () => { setRemoving(null); setNeedsTarget(false); setReassign(""); refresh(); },
    onError: (e) => { if (e.code === "category_in_use") { setNeedsTarget(true); toast.info(e.message); } else toast.error(e.message); },
  });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const flat = tree.flatMap((c) => [{ node: c, parent: null as string | null, depth: 0 }, ...c.children.map((k) => ({ node: k, parent: c.id, depth: 1 }))]);
  const persist = (next: typeof flat) => {
    const items: { id: string; parent: string | null; order: number }[] = [];
    let currentRoot: string | null = null, rootOrder = 0, childOrder = 0;
    next.forEach((row) => {
      if (row.depth === 0) { currentRoot = row.node.id; items.push({ id: row.node.id, parent: null, order: rootOrder++ }); childOrder = 0; }
      else items.push({ id: row.node.id, parent: currentRoot, order: childOrder++ });
    });
    post("/admin/categories/reorder/", { items }).then(refresh).catch((e: ApiError) => { toast.error(e.message); refresh(); });
  };
  const onEnd = ({ active, over, delta }: DragEndEvent) => {
    if (!over) return;
    const from = flat.findIndex((r) => r.node.id === active.id);
    const to = flat.findIndex((r) => r.node.id === over.id);
    if (from < 0 || to < 0) return;
    const moved = arrayMove(flat, from, to);
    const row = moved[to];
    const nest = delta.x > 24 && to > 0 && row.node.children.length === 0; // dragging right makes it a subcategory
    const outdent = delta.x < -24;
    if (nest) row.depth = 1; else if (outdent) row.depth = 0;
    if (moved[0].depth === 1) moved[0].depth = 0;
    const next = moved.map((r) => ({ ...r }));
    let root: CategoryNode | null = null;
    const rebuilt: CategoryNode[] = [];
    next.forEach((r) => {
      if (r.depth === 0) { root = { ...r.node, children: [] }; rebuilt.push(root); } else root?.children.push({ ...r.node, children: [] });
    });
    setTree(rebuilt);
    persist(next);
  };
  const options = flat.filter((r) => r.node.id !== removing?.id && r.parent !== removing?.id).map((r) => ({ value: r.node.id, label: r.depth ? `— ${r.node.name}` : r.node.name }));
  return (
    <>
      <PageHeader title="Categories" description="Drag to reorder. Drag right to nest as a subcategory, left to bring it back out." actions={<Button onClick={() => setEditing({ name: "", parent: null, is_active: true })}><Plus />New category</Button>} />
      {!data ? <Skeleton className="h-96" /> : flat.length === 0 ? <EmptyState icon={FolderTree} title="No categories yet" text="Group your lessons by subject." action={<Button onClick={() => setEditing({ name: "", parent: null, is_active: true })}><Plus />New category</Button>} /> : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onEnd}>
          <SortableContext items={flat.map((r) => r.node.id)} strategy={verticalListSortingStrategy}>
            <div className="max-w-2xl space-y-1.5">
              {flat.map((r) => <CategoryRow key={r.node.id} node={r.node} depth={r.depth} onEdit={(c) => setEditing({ ...c, parent: r.parent })} onDelete={setRemoving} onAddChild={r.depth === 0 ? (c) => setEditing({ name: "", parent: c.id, is_active: true }) : undefined} />)}
            </div>
          </SortableContext>
        </DndContext>
      )}
      <Sheet open={!!editing} onOpenChange={(v) => { if (!v) setEditing(null); }} title={editing?.id ? "Edit category" : "New category"} size="sm" footer={<Button loading={save.isPending} disabled={!editing?.name} onClick={() => save.mutate()}>Save</Button>}>
        {editing && <div className="space-y-4">
          <Field label="Name"><Input autoFocus value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
          <Field label="Description"><Textarea rows={2} value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
          <Field label="Colour"><input aria-label="Colour" type="color" value={editing.color || "#4F46E5"} onChange={(e) => setEditing({ ...editing, color: e.target.value })} className="h-10 w-16 rounded-md border bg-surface p-1" /></Field>
          <Switch label="Visible to students" checked={editing.is_active ?? true} onChange={(is_active) => setEditing({ ...editing, is_active })} />
        </div>}
      </Sheet>
      <ConfirmSheet open={!!removing} onOpenChange={(v) => { if (!v) { setRemoving(null); setNeedsTarget(false); setReassign(""); } }} title={`Delete ${removing?.name}?`} text={needsTarget ? "Lessons here must move first. Choose where they should go." : "This cannot be undone."} confirmLabel={needsTarget ? "Move and delete" : "Delete"} danger loading={remove.isPending} onConfirm={() => remove.mutate()}>
        {needsTarget && <Select label="Move to" placeholder="Choose a category" value={reassign} onChange={setReassign} options={options} />}
      </ConfirmSheet>
    </>
  );
}

/* ---------- Media ---------- */
const MEDIA_STATUS: Record<string, "success" | "warning" | "danger" | "info"> = { ready: "success", processing: "info", uploaded: "info", failed: "danger", uploading: "warning" };
type Asset = PickedAsset & { error_message: string; created_at: string; usage_count: number };
function StatusBadge({ a }: { a: Asset }) {
  if (a.status === "processing") return <Badge tone="info">Processing {a.processing_progress}%</Badge>;
  return <Badge tone={MEDIA_STATUS[a.status]}>{a.status}</Badge>;
}
export function MediaLibrary() {
  const params = useSearchParams();
  const [view, setView] = useState<"grid" | "list">("grid");
  const [detail, setDetail] = useState<Asset | null>(null);
  const [term, setTerm] = useState("");
  const replaceInput = useRef<HTMLInputElement>(null);
  const table = useTable<Asset>("/admin/media/", { kind: "", status: params.get("status") ?? "" }, { refetchInterval: 4000 });
  const debounced = useDebounced(term);
  useEffect(() => { table.setSearch(debounced); }, [debounced]); // eslint-disable-line
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: ["/admin/media/"] });
  const usage = useQuery({ queryKey: ["usages", detail?.id], enabled: !!detail, queryFn: () => api<{ id: string; title: string; status: string }[]>(`/admin/media/${detail!.id}/usages/`) });
  const remove = useAction(() => del(`/admin/media/${detail!.id}/`), { success: "File deleted", onSuccess: () => { setDetail(null); refresh(); } });
  const retry = useAction((id: string) => post(`/admin/media/${id}/retry/`), { success: "Retrying", onSuccess: refresh });
  const upload = async (files: File[]) => { await Promise.all(files.map((f) => uploadFile(f).catch((e: Error) => toast.error(`${f.name}: ${e.message}`)))); refresh(); };
  const replace = async (file?: File) => {
    if (!file || !detail) return;
    try { await uploadFile(file, { replaces: detail.id }); toast.success("File replaced"); setDetail(null); refresh(); } catch (e) { toast.error((e as Error).message); }
  };
  const rows = table.rows;
  return (
    <>
      <PageHeader title="Media library" description="Every file your lessons use." />
      <FileDropzone multiple onFiles={upload} className="mb-4" hint="Large files upload in resumable chunks. You can keep working while they finish." />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1 md:max-w-xs"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" aria-hidden /><Input aria-label="Search files" className="pl-9" placeholder="Search files" value={term} onChange={(e) => setTerm(e.target.value)} /></div>
        <Select label="Kind" className="w-32" placeholder="Kind" value={table.filters.kind} onChange={(v) => table.setFilter("kind", v)} options={[{ value: "", label: "All kinds" }, ...["pdf", "image", "video", "audio", "docx", "pptx", "xlsx", "epub"].map((k) => ({ value: k, label: k.toUpperCase() }))]} />
        <Select label="Status" className="w-32" placeholder="Status" value={table.filters.status} onChange={(v) => table.setFilter("status", v)} options={[{ value: "", label: "All" }, { value: "ready", label: "Ready" }, { value: "processing", label: "Processing" }, { value: "failed", label: "Failed" }]} />
        <div className="ml-auto flex gap-1">
          <IconButton label="Grid view" aria-pressed={view === "grid"} variant={view === "grid" ? "soft" : "ghost"} onClick={() => setView("grid")}><LayoutGrid /></IconButton>
          <IconButton label="List view" aria-pressed={view === "list"} variant={view === "list" ? "soft" : "ghost"} onClick={() => setView("list")}><ListIcon /></IconButton>
        </div>
      </div>
      {table.query.isLoading ? <Skeleton className="h-72" /> : rows.length === 0 ? <EmptyState icon={ImageIcon} title="No files yet" text="Upload a file above and it will appear here." /> : view === "grid" ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {rows.map((a) => (
            <li key={a.id}>
              <button onClick={() => setDetail(a)} className="w-full overflow-hidden rounded-xl border bg-surface text-left shadow-sm hover:shadow-md">
                <AssetThumb asset={a} className="aspect-[4/3] w-full" />
                {a.status === "processing" && <ProgressBar className="h-1 rounded-none" value={a.processing_progress} label="Processing" />}
                <div className="p-2.5"><div className="truncate text-[13px] font-medium">{a.original_filename}</div><div className="mt-1 flex items-center justify-between gap-1 text-xs text-fg-3"><span>{fileSize(a.size)}</span><StatusBadge a={a} /></div></div>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="divide-y rounded-xl border bg-surface">
          {rows.map((a) => (
            <li key={a.id}><button onClick={() => setDetail(a)} className="flex min-h-14 w-full items-center gap-3 p-2.5 text-left hover:bg-surface-2">
              <AssetThumb asset={a} className="size-10 shrink-0 rounded-md" />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{a.original_filename}</span><span className="text-[13px] text-fg-3">{a.kind.toUpperCase()} · {fileSize(a.size)} · used in {a.usage_count}</span></span>
              <StatusBadge a={a} />
            </button></li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex items-center justify-between"><span className="text-[13px] text-fg-3">{table.total ?? 0} files</span><Pagination page={table.page} totalPages={table.totalPages} onChange={table.setPage} /></div>
      <Sheet open={!!detail} onOpenChange={(v) => { if (!v) setDetail(null); }} title={detail?.original_filename ?? ""}>
        {detail && <div className="space-y-4">
          <AssetThumb asset={detail} className="aspect-video w-full rounded-lg" />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div><dt className="text-[13px] text-fg-3">Type</dt><dd>{detail.mime || detail.kind}</dd></div>
            <div><dt className="text-[13px] text-fg-3">Size</dt><dd>{fileSize(detail.size)}</dd></div>
            {detail.page_count ? <div><dt className="text-[13px] text-fg-3">Pages</dt><dd>{detail.page_count}</dd></div> : null}
            {detail.duration ? <div><dt className="text-[13px] text-fg-3">Duration</dt><dd>{duration(detail.duration)}</dd></div> : null}
            <div><dt className="text-[13px] text-fg-3">Status</dt><dd><StatusBadge a={detail} /></dd></div>
            <div><dt className="text-[13px] text-fg-3">Uploaded</dt><dd>{dateTime(detail.created_at)}</dd></div>
          </dl>
          {detail.error_message && <p className="rounded-lg bg-danger-soft p-3 text-sm text-danger">{detail.error_message}</p>}
          <div><div className="mb-1 text-[13px] font-semibold">Used in {usage.data?.length ?? "…"} {usage.data?.length === 1 ? "item" : "items"}</div>
            <ul className="space-y-0.5">{usage.data?.map((c) => <li key={c.id}><Link href={`/admin/contents/${c.id}`} className="text-sm text-primary-ink">{c.title}</Link></li>)}</ul></div>
          <div className="flex flex-wrap gap-2">
            {detail.status === "failed" && <Button loading={retry.isPending} onClick={() => retry.mutate(detail.id)}><RotateCw />Retry</Button>}
            <Button variant="secondary" onClick={() => replaceInput.current?.click()}><Upload />Replace file</Button>
            <input ref={replaceInput} type="file" hidden onChange={(e) => replace(e.target.files?.[0])} />
            <Button variant="secondary" className="text-danger" disabled={!!usage.data?.length} loading={remove.isPending} onClick={() => remove.mutate()}><Trash2 />Delete</Button>
          </div>
          {!!usage.data?.length && <p className="text-[13px] text-fg-3">Files in use cannot be deleted. Replacing keeps every link working.</p>}
        </div>}
      </Sheet>
    </>
  );
}

/* ---------- Plans ---------- */
const BLANK: Partial<Plan> = { name: "", description: "", price: 10000, promo_price: null, duration_days: 30, features: [], is_active: true, highlighted: false, order: 0 };
export function Plans() {
  const { data } = useQuery({ queryKey: ["admin-plans"], queryFn: () => api<Plan[]>("/admin/plans/") });
  const [edit, setEdit] = useState<Partial<Plan> | null>(null);
  const [remove, setRemove] = useState<Plan | null>(null);
  const { data: site, refetch } = useQuery({ queryKey: ["site-settings"], queryFn: () => api<any>("/admin/settings/site/") });
  const [defaultPrice, setDefaultPrice] = useState("");
  useEffect(() => { if (site) setDefaultPrice(String(site.default_content_price)); }, [site]);
  const save = useAction(() => (edit!.id ? patch(`/admin/plans/${edit!.id}/`, edit) : post("/admin/plans/", edit)), { success: "Plan saved", invalidate: [["admin-plans"]], onSuccess: () => setEdit(null) });
  const destroy = useAction(() => del(`/admin/plans/${remove!.id}/`), { success: "Plan deleted", invalidate: [["admin-plans"]], onSuccess: () => setRemove(null) });
  const savePrice = useAction(() => patch("/admin/settings/site/", { default_content_price: Number(defaultPrice) }), { success: "Default price saved", onSuccess: () => refetch() });
  return (
    <>
      <PageHeader title="Plans & pricing" description="Changing a price affects new buyers only. People who already paid keep their terms." actions={<Button onClick={() => setEdit({ ...BLANK })}><Plus />New plan</Button>} />
      {!data ? <Skeleton className="h-48" /> : data.length === 0 ? <EmptyState icon={Star} title="No plans yet" text="Create a plan so students can subscribe." action={<Button onClick={() => setEdit({ ...BLANK })}><Plus />New plan</Button>} /> : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {data.map((p) => (
            <Card key={p.id} className={cn("flex flex-col p-4", !p.is_active && "opacity-60")}>
              <div className="flex items-start justify-between gap-2"><h2 className="font-semibold tracking-tight">{p.name}</h2><div className="flex gap-1">{p.highlighted && <Badge tone="primary">Highlighted</Badge>}{!p.is_active && <Badge>Inactive</Badge>}</div></div>
              <div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{money(p.effective_price)}</div>
              <div className="text-[13px] text-fg-3">{p.duration_days} days · {p.features.length} features</div>
              <div className="mt-4 flex gap-2"><Button variant="secondary" size="sm" onClick={() => setEdit(p)}><Pencil />Edit</Button><Button variant="ghost" size="sm" onClick={() => setRemove(p)}><Trash2 />Delete</Button></div>
            </Card>
          ))}
        </div>
      )}
      <Card className="mt-6 max-w-md p-4">
        <Field label="Default price for new paid content (TZS)"><div className="flex gap-2"><Input type="number" min={500} value={defaultPrice} onChange={(e) => setDefaultPrice(e.target.value)} /><Button variant="secondary" loading={savePrice.isPending} onClick={() => savePrice.mutate()}>Save</Button></div></Field>
      </Card>
      <Sheet open={!!edit} onOpenChange={(v) => { if (!v) setEdit(null); }} title={edit?.id ? "Edit plan" : "New plan"} footer={<Button loading={save.isPending} disabled={!edit?.name} onClick={() => save.mutate()}>Save plan</Button>}>
        {edit && <div className="space-y-4">
          <Field label="Name"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="Description"><Textarea rows={2} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Price (TZS)"><Input type="number" min={500} value={edit.price} onChange={(e) => setEdit({ ...edit, price: Number(e.target.value) })} /></Field>
            <Field label="Promo price"><Input type="number" min={500} value={edit.promo_price ?? ""} onChange={(e) => setEdit({ ...edit, promo_price: e.target.value ? Number(e.target.value) : null })} /></Field>
          </div>
          <Field label="Duration (days)"><Input type="number" min={1} value={edit.duration_days} onChange={(e) => setEdit({ ...edit, duration_days: Number(e.target.value) })} /></Field>
          <Field label="Features" hint="One per line"><Textarea rows={4} value={(edit.features ?? []).join("\n")} onChange={(e) => setEdit({ ...edit, features: e.target.value.split("\n") })} onBlur={() => setEdit({ ...edit, features: (edit.features ?? []).map((f) => f.trim()).filter(Boolean) })} /></Field>
          <Switch label="Highlighted" description="Marked as the best value" checked={!!edit.highlighted} onChange={(highlighted) => setEdit({ ...edit, highlighted })} />
          <Switch label="Active" description="Shown on the pricing page" checked={!!edit.is_active} onChange={(is_active) => setEdit({ ...edit, is_active })} />
        </div>}
      </Sheet>
      <ConfirmSheet open={!!remove} onOpenChange={(v) => { if (!v) setRemove(null); }} title={`Delete ${remove?.name}?`} text="Plans with orders cannot be deleted. Deactivate them instead." confirmLabel="Delete" danger loading={destroy.isPending} onConfirm={() => destroy.mutate()} />
    </>
  );
}

/* ---------- Comments ---------- */
type Mod = { id: string; body: string; status: string; is_pinned: boolean; report_count: number; author_name: string; is_teacher: boolean; created_at: string; content_title: string; content_slug: string; content_id: string; content_allow_comments: boolean };
const MOD_KEY = "/admin/comments/";
const TONES: Record<string, "warning" | "success" | "neutral" | "danger"> = { pending: "warning", approved: "success", hidden: "neutral", spam: "danger" };
export function Moderation() {
  const table = useTable<Mod>(MOD_KEY, { status: "pending" });
  const counts = useQuery({ queryKey: ["comment-counts"], queryFn: () => api<Record<string, number>>("/admin/comments/counts/") });
  const [reply, setReply] = useState<Mod | null>(null);
  const [text, setText] = useState("");
  const client = useQueryClient();
  const after = () => { client.invalidateQueries({ queryKey: [MOD_KEY] }); client.invalidateQueries({ queryKey: ["comment-counts"] }); };
  const bulk = useAction((v: { ids: string[]; action: string }) => post("/admin/comments/bulk/", v), { success: "Updated", onSuccess: after });
  const toggleLesson = useAction((r: Mod) => patch(`/admin/contents/${r.content_id}/`, { allow_comments: !r.content_allow_comments }), { success: "Lesson comments updated", onSuccess: after });
  const send = useAction(() => post(`/admin/comments/${reply!.id}/reply/`, { body: text }), { success: "Reply posted", onSuccess: () => { setReply(null); setText(""); after(); } });
  const columns: Column<Mod>[] = [
    { key: "body", header: "Comment", cell: (r) => <div className="min-w-0"><p className="line-clamp-2 whitespace-pre-wrap text-sm">{r.body}</p><div className="mt-0.5 truncate text-[13px] text-fg-3">{r.author_name} on <Link href={`/content/${r.content_slug}`} className="text-primary-ink">{r.content_title}</Link>{r.report_count > 0 && ` · reported ${r.report_count}×`}</div></div> },
    { key: "status", header: "Status", cell: (r) => <Badge tone={TONES[r.status]}>{r.status}</Badge> },
    { key: "created", header: "When", mobile: false, cell: (r) => <span className="whitespace-nowrap text-fg-2">{timeAgo(r.created_at)}</span> },
    { key: "actions", header: "", className: "w-56", cell: (r) => (
      <div className="flex justify-end gap-1">
        {r.status !== "approved" && <Button size="sm" variant="secondary" onClick={() => bulk.mutate({ ids: [r.id], action: "approve" })}>Approve</Button>}
        <Button size="sm" variant="ghost" onClick={() => setReply(r)}>Reply</Button>
        <Dropdown>
          <DropdownTrigger asChild><IconButton label="More" size="icon-sm"><MoreHorizontal /></IconButton></DropdownTrigger>
          <DropdownContent>
            <DropdownItem onSelect={() => bulk.mutate({ ids: [r.id], action: r.is_pinned ? "unpin" : "pin" })}><Pin />{r.is_pinned ? "Unpin" : "Pin"}</DropdownItem>
            <DropdownItem onSelect={() => bulk.mutate({ ids: [r.id], action: "hide" })}>Hide</DropdownItem>
            <DropdownItem onSelect={() => toggleLesson.mutate(r)}><MessageSquare />{r.content_allow_comments ? "Close comments on this lesson" : "Reopen comments on this lesson"}</DropdownItem>
            <DropdownItem onSelect={() => bulk.mutate({ ids: [r.id], action: "spam" })}>Mark as spam</DropdownItem>
            <DropdownItem danger onSelect={() => bulk.mutate({ ids: [r.id], action: "delete" })}><Trash2 />Delete</DropdownItem>
          </DropdownContent>
        </Dropdown>
      </div>
    ) },
  ];
  const c = counts.data ?? {};
  return (
    <>
      <PageHeader title="Comments" description="Moderate what students see." />
      <Tabs className="mb-4" value={table.filters.status} onChange={(v) => table.setFilter("status", v)} items={["pending", "approved", "spam", "hidden"].map((s) => ({ value: s, label: `${s[0].toUpperCase()}${s.slice(1)}${c[s] ? ` (${c[s]})` : ""}` }))} />
      <DataTable columns={columns} rows={table.rows} rowId={(r) => r.id} loading={table.query.isLoading} total={table.total} page={table.page} totalPages={table.totalPages} onPage={table.setPage} search={table.search} onSearch={table.setSearch} searchPlaceholder="Search comments"
        bulkActions={(ids, clear) => (<>
          <Button size="sm" variant="secondary" onClick={() => bulk.mutate({ ids, action: "approve" }, { onSuccess: clear })}>Approve</Button>
          <Button size="sm" variant="secondary" onClick={() => bulk.mutate({ ids, action: "hide" }, { onSuccess: clear })}>Hide</Button>
          <Button size="sm" variant="secondary" onClick={() => bulk.mutate({ ids, action: "spam" }, { onSuccess: clear })}>Spam</Button>
        </>)}
        empty={{ icon: MessageSquare, title: "All clear", text: "No comments in this queue right now." }} />
      <Sheet open={!!reply} onOpenChange={(v) => { if (!v) setReply(null); }} title={`Reply to ${reply?.author_name}`} description="Your reply is marked Teacher." footer={<Button loading={send.isPending} disabled={!text.trim()} onClick={() => send.mutate()}>Post reply</Button>}>
        <p className="mb-3 rounded-lg bg-surface-2 p-3 text-sm">{reply?.body}</p>
        <Textarea aria-label="Reply" autoFocus value={text} onChange={(e) => setText(e.target.value)} />
      </Sheet>
    </>
  );
}

/* ---------- Audit ---------- */
type Audit = { id: number; actor_label: string; action: string; target_type: string; target_label: string; diff: Record<string, unknown>; ip: string | null; timestamp: string };
export function AuditLog() {
  const table = useTable<Audit>("/admin/audit/");
  const [open, setOpen] = useState<Audit | null>(null);
  const columns: Column<Audit>[] = [
    { key: "action", header: "Action", cell: (r) => <code className="text-[13px]">{r.action}</code> },
    { key: "target", header: "Target", cell: (r) => <span className="block max-w-72 truncate">{r.target_label || "—"}</span> },
    { key: "actor", header: "By", cell: (r) => r.actor_label },
    { key: "ip", header: "IP", mobile: false, hiddenByDefault: true, cell: (r) => r.ip ?? "—" },
    { key: "when", header: "When", cell: (r) => <span className="whitespace-nowrap text-fg-2">{dateTime(r.timestamp)}</span> },
  ];
  return (
    <>
      <PageHeader title="Audit log" description="Every change to settings, prices, users and content." />
      <DataTable columns={columns} rows={table.rows} rowId={(r) => String(r.id)} loading={table.query.isLoading} total={table.total} page={table.page} totalPages={table.totalPages} onPage={table.setPage} search={table.search} onSearch={table.setSearch} searchPlaceholder="Search the log" onRowClick={setOpen}
        empty={{ icon: FileClock, title: "Nothing logged yet", text: "Admin changes will be recorded here." }} />
      <Sheet open={!!open} onOpenChange={(v) => { if (!v) setOpen(null); }} title={open?.action ?? ""} description={`${open?.actor_label} · ${dateTime(open?.timestamp)}`}>
        <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 text-[13px]">{JSON.stringify(open?.diff ?? {}, null, 2)}</pre>
      </Sheet>
    </>
  );
}
export { FileIcon };
