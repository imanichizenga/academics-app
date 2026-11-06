"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, Clock, Eye, History, Loader2, Monitor, Settings2, Smartphone, Trash2, Upload } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { toast } from "sonner";
import { BodyRenderer } from "@/components/content/body";
import { CheckoutProvider } from "@/components/content/checkout";
import { Button, IconButton } from "@/components/ui/button";
import { Badge, Card, Skeleton } from "@/components/ui/display";
import { FileDropzone } from "@/components/ui/dropzone";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/form";
import { Link } from "@/components/ui/link";
import { Sheet, useIsMobile } from "@/components/ui/overlay";
import { ApiError, api, patch, post } from "@/lib/api";
import { useAction, useSite } from "@/lib/providers";
import { cn, dateTime, fileSize, timeAgo } from "@/lib/utils";
import { MediaPicker, type PickedAsset } from "./media-picker";
import { useCategoryOptions } from "./content-list";

const RichEditor = dynamic(() => import("@/components/editor/editor").then((m) => m.RichEditor), { ssr: false, loading: () => <Skeleton className="mt-4 h-96" /> });
type Doc = Record<string, any>;
const SETTINGS_FIELDS = ["slug", "excerpt", "category", "content_type", "access_level", "price", "promo_price", "access_duration_days", "included_in_subscription", "preview_blocks", "preview_seconds", "preview_pages", "allow_comments", "allow_reactions", "allow_bookmarks", "allow_download", "show_view_count", "featured", "seo_title", "seo_description", "cover_image", "cover_thumb", "main_asset", "tags", "scheduled_for"];

function cropImage(src: string, area: Area) {
  return new Promise<Blob>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = area.width; canvas.height = area.height;
      canvas.getContext("2d")!.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not crop"))), "image/jpeg", 0.92);
    };
    img.onerror = reject;
    img.src = src;
  });
}
function CoverField({ url, onChange }: { url: string; onChange: (d: { key: string; thumb_key: string; url: string } | null) => void }) {
  const [source, setSource] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!source || !area) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", new File([await cropImage(source, area)], "cover.jpg", { type: "image/jpeg" }));
      onChange(await api("/admin/images/", { form }));
      setSource(null);
    } catch (e) { toast.error((e as ApiError).message ?? "Upload failed"); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2">
      {url ? (
        <div className="relative overflow-hidden rounded-lg border"><img src={url} alt="Cover" className="aspect-video w-full object-cover" /><IconButton label="Remove cover" size="icon-sm" variant="secondary" className="absolute right-2 top-2" onClick={() => onChange(null)}><Trash2 /></IconButton></div>
      ) : <FileDropzone accept="image/*" label="Add a cover image" hint="16:9 works best" onFiles={(f) => { if (f[0]) setSource(URL.createObjectURL(f[0])); }} />}
      <Sheet open={!!source} onOpenChange={(v) => { if (!v) setSource(null); }} title="Crop cover" size="lg" footer={<Button loading={busy} onClick={save}>Use this crop</Button>}>
        <div className="relative h-72 overflow-hidden rounded-lg bg-black">{source && <Cropper image={source} crop={crop} zoom={zoom} aspect={16 / 9} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_, a) => setArea(a)} />}</div>
        <input aria-label="Zoom" type="range" min={1} max={3} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="mt-3 w-full accent-[var(--primary)]" />
      </Sheet>
    </div>
  );
}
function CategoryPicker({ value, onChange }: { value: string | null; onChange: (v: string) => void }) {
  const { options } = useCategoryOptions();
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const client = useQueryClient();
  const current = options.find((o) => o.value === value)?.label;
  const matches = options.filter((o) => String(o.label).toLowerCase().includes(term.toLowerCase()));
  const create = useAction(() => post("/admin/categories/", { name: term }), { success: "Category created", onSuccess: (c) => { client.invalidateQueries({ queryKey: ["admin-categories"] }); onChange(c.id); setOpen(false); setTerm(""); } });
  return (
    <>
      <Button variant="secondary" className="w-full justify-between font-normal" onClick={() => setOpen(true)}><span className="truncate">{current ?? "Choose a category"}</span></Button>
      <Sheet open={open} onOpenChange={setOpen} title="Category" size="sm">
        <Input autoFocus aria-label="Search categories" placeholder="Search or create" value={term} onChange={(e) => setTerm(e.target.value)} />
        <ul className="mt-2 max-h-72 space-y-0.5 overflow-y-auto">
          {matches.map((o) => <li key={o.value}><button type="button" className="flex min-h-10 w-full items-center justify-between rounded-md px-2.5 text-left text-sm hover:bg-surface-2" onClick={() => { onChange(o.value); setOpen(false); }}>{o.label}{o.value === value && <Check className="size-4 text-primary-ink" />}</button></li>)}
        </ul>
        {term && !matches.some((o) => String(o.label).toLowerCase() === term.toLowerCase()) && <Button variant="soft" className="mt-2 w-full" loading={create.isPending} onClick={() => create.mutate()}>Create “{term}”</Button>}
      </Sheet>
    </>
  );
}
function TagInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState("");
  const add = () => { const t = text.trim().replace(/,$/, ""); if (t && !value.includes(t)) onChange([...value, t]); setText(""); };
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-1 rounded-lg border border-border-strong bg-surface p-1.5">
      {value.map((t) => <button key={t} type="button" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((x) => x !== t))} className="inline-flex h-7 items-center gap-1 rounded-md bg-surface-2 px-2 text-[13px]">{t} ×</button>)}
      <input aria-label="Add a tag" value={text} placeholder={value.length ? "" : "Add tags"} onChange={(e) => setText(e.target.value)} onBlur={add} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }} className="h-7 min-w-20 flex-1 bg-transparent px-1 text-sm outline-none" />
    </div>
  );
}
const num = (v: string) => (v === "" ? null : Number(v));

function Panel({ doc, set }: { doc: Doc; set: (p: Doc) => void }) {
  const site = useSite();
  const [picker, setPicker] = useState(false);
  const paid = doc.access_level === "paid";
  const needsFile = ["document", "video", "audio", "mixed"].includes(doc.content_type);
  return (
    <div className="space-y-5">
      <Group title="Cover"><CoverField url={doc.cover_url} onChange={(d) => set(d ? { cover_image: d.key, cover_thumb: d.thumb_key, cover_url: d.url } : { cover_image: "", cover_thumb: "", cover_url: "" })} /></Group>
      <Group title="Organise">
        <Field label="Category"><CategoryPicker value={doc.category} onChange={(category) => set({ category })} /></Field>
        <Field label="Tags"><TagInput value={doc.tags ?? doc.tag_names ?? []} onChange={(tags) => set({ tags })} /></Field>
        <Field label="Content type"><Select value={doc.content_type} onChange={(content_type) => set({ content_type })} options={[{ value: "article", label: "Article" }, { value: "document", label: "Document" }, { value: "video", label: "Video" }, { value: "audio", label: "Audio" }, { value: "mixed", label: "Mixed" }]} /></Field>
        {needsFile && (
          <Field label="Main file">
            {doc.main_media ? (
              <div className="flex items-center gap-2 rounded-lg border p-2 text-sm">
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{doc.main_media.original_filename}</span><span className="text-[13px] text-fg-3">{fileSize(doc.main_media.size)} · {doc.main_media.status === "ready" ? "Ready" : `Processing ${doc.main_media.processing_progress}%`}</span></span>
                <IconButton label="Remove file" size="icon-sm" onClick={() => set({ main_asset: null, main_media: null })}><Trash2 /></IconButton>
              </div>
            ) : <Button variant="secondary" className="w-full" onClick={() => setPicker(true)}><Upload />Choose a file</Button>}
          </Field>
        )}
        <Field label="Excerpt"><Textarea rows={3} value={doc.excerpt} onChange={(e) => set({ excerpt: e.target.value })} /></Field>
      </Group>
      <Group title="Access">
        <Field label="Access level"><Select value={doc.access_level} onChange={(access_level) => set({ access_level, price: access_level === "paid" ? doc.price ?? site.default_content_price : doc.price })} options={[{ value: "free", label: "Free" }, { value: "paid", label: "Paid" }]} /></Field>
        {paid && (<>
          <Field label="Price (TZS)" hint="Minimum 500. Empty means subscribers only."><Input type="number" min={500} value={doc.price ?? ""} onChange={(e) => set({ price: num(e.target.value) })} /></Field>
          <Field label="Promo price (optional)"><Input type="number" min={500} value={doc.promo_price ?? ""} onChange={(e) => set({ promo_price: num(e.target.value) })} /></Field>
          <Field label="Access duration (days)" hint="Empty means lifetime"><Input type="number" min={1} value={doc.access_duration_days ?? ""} onChange={(e) => set({ access_duration_days: num(e.target.value) })} /></Field>
          <Switch label="Included in subscription" checked={doc.included_in_subscription} onChange={(v) => set({ included_in_subscription: v })} />
          <Field label="Free preview" hint={doc.content_type === "video" ? "Seconds of video" : doc.content_type === "document" ? "Pages of the PDF" : "Blocks of the article"}>
            {doc.content_type === "video" ? <Input type="number" min={0} value={doc.preview_seconds} onChange={(e) => set({ preview_seconds: Number(e.target.value) })} />
              : doc.content_type === "document" ? <Input type="number" min={1} value={doc.preview_pages} onChange={(e) => set({ preview_pages: Number(e.target.value) })} />
                : <Input type="number" min={0} value={doc.preview_blocks} onChange={(e) => set({ preview_blocks: Number(e.target.value) })} />}
          </Field>
        </>)}
      </Group>
      <Group title="Engagement">
        <Switch label="Comments" checked={doc.allow_comments} onChange={(v) => set({ allow_comments: v })} />
        <Switch label="Reactions" checked={doc.allow_reactions} onChange={(v) => set({ allow_reactions: v })} />
        <Switch label="Bookmarks" checked={doc.allow_bookmarks} onChange={(v) => set({ allow_bookmarks: v })} />
        <Switch label="Downloads" checked={doc.allow_download} onChange={(v) => set({ allow_download: v })} />
        <Switch label="Show view count" checked={doc.show_view_count} onChange={(v) => set({ show_view_count: v })} />
        <Switch label="Featured on home" checked={doc.featured} onChange={(v) => set({ featured: v })} />
      </Group>
      <Group title="Search preview">
        <div className="rounded-lg border p-3 font-sans">
          <div className="truncate text-[13px] text-fg-3">{typeof location !== "undefined" ? location.host : ""}/content/{doc.slug}</div>
          <div className="truncate text-[17px] text-[#1a0dab] dark:text-[#8ab4f8]">{doc.seo_title || doc.title || "Title"}</div>
          <div className="line-clamp-2 text-[13px] text-fg-2">{doc.seo_description || doc.excerpt || "Add a description."}</div>
        </div>
        <Field label="SEO title"><Input value={doc.seo_title} maxLength={200} onChange={(e) => set({ seo_title: e.target.value })} /></Field>
        <Field label="SEO description"><Textarea rows={2} maxLength={320} value={doc.seo_description} onChange={(e) => set({ seo_description: e.target.value })} /></Field>
        <Field label="Slug"><Input value={doc.slug} onChange={(e) => set({ slug: e.target.value })} /></Field>
      </Group>
      <MediaPicker open={picker} onOpenChange={setPicker} contentId={doc.id} title="Main file" kinds={doc.content_type === "video" || doc.content_type === "mixed" ? ["video"] : doc.content_type === "audio" ? ["audio"] : ["pdf", "docx", "pptx", "xlsx", "epub", "txt"]}
        onPick={(a: PickedAsset) => set({ main_asset: a.id, main_media: a })} />
    </div>
  );
}
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-3"><h3 className="text-[13px] font-semibold text-fg-2">{title}</h3>{children}</section>;
}
function Preview({ open, onOpenChange, id, saved }: { open: boolean; onOpenChange: (v: boolean) => void; id: string; saved: number }) {
  const [mode, setMode] = useState<"mobile" | "desktop">("desktop");
  const { data } = useQuery({ queryKey: ["admin-preview", id, saved], enabled: open, queryFn: () => api<any>(`/admin/contents/${id}/preview/`) });
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Preview" description="Exactly what a student with access sees." size="lg">
      <div className="mb-3 flex gap-1"><Button size="sm" variant={mode === "desktop" ? "soft" : "ghost"} onClick={() => setMode("desktop")}><Monitor />Desktop</Button><Button size="sm" variant={mode === "mobile" ? "soft" : "ghost"} onClick={() => setMode("mobile")}><Smartphone />Mobile</Button></div>
      <div className={cn("mx-auto rounded-lg border bg-bg p-4", mode === "mobile" ? "max-w-[390px]" : "max-w-full")}>
        {!data ? <Skeleton className="h-64" /> : (<>
          <h1 className="text-2xl font-semibold tracking-tight">{data.title}</h1>
          {data.subtitle && <p className="mt-1 font-serif text-lg text-fg-2">{data.subtitle}</p>}
          <div className="prose-reading mt-4"><CheckoutProvider><BodyRenderer html={data.body_html} /></CheckoutProvider></div>
        </>)}
      </div>
    </Sheet>
  );
}
function Revisions({ open, onOpenChange, id, onRestore }: { open: boolean; onOpenChange: (v: boolean) => void; id: string; onRestore: () => void }) {
  const { data } = useQuery({ queryKey: ["revisions", id], enabled: open, queryFn: () => api<any[]>(`/admin/contents/${id}/revisions/`) });
  const restore = useAction((rev: number) => post(`/admin/contents/${id}/revisions/${rev}/restore/`), { success: "Revision restored", onSuccess: () => { onOpenChange(false); onRestore(); } });
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Revision history">
      {!data ? <Skeleton className="h-40" /> : data.length === 0 ? <p className="py-6 text-center text-sm text-fg-2">No revisions yet.</p> : (
        <ul className="divide-y">
          {data.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{r.label || "Revision"}</div><div className="text-[13px] text-fg-3">{dateTime(r.created_at)} · {r.word_count} words{r.author_name && ` · ${r.author_name}`}</div></div>
              <Button size="sm" variant="secondary" loading={restore.isPending && restore.variables === r.id} onClick={() => restore.mutate(r.id)}>Restore</Button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

export function ContentEditor({ id }: { id: string }) {
  const router = useRouter();
  const isNew = id === "new";
  const client = useQueryClient();
  const creating = useRef(false);
  useEffect(() => {
    if (!isNew || creating.current) return;
    creating.current = true;
    post("/admin/contents/", { title: "", content_type: "article" }).then((c) => router.replace(`/admin/contents/${c.id}`)).catch((e) => toast.error(e.message));
  }, [isNew, router]);
  const { data, refetch } = useQuery({ queryKey: ["admin-content", id], enabled: !isNew, refetchOnWindowFocus: false, gcTime: 0, queryFn: () => api<Doc>(`/admin/contents/${id}/`) });
  if (isNew || !data) return <div className="space-y-4"><Skeleton className="h-12 w-3/4" /><Skeleton className="h-96" /></div>;
  return <EditorInner key={data.id} initial={data} reload={async () => { client.removeQueries({ queryKey: ["admin-content", id] }); await refetch(); }} />;
}

function EditorInner({ initial, reload }: { initial: Doc; reload: () => void }) {
  const [doc, setDoc] = useState<Doc>(initial);
  const [save, setSave] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [savedAt, setSavedAt] = useState<number>(Date.now());
  const [, tick] = useState(0);
  const [words, setWords] = useState(initial.word_count ?? 0);
  const [panel, setPanel] = useState(false);
  const [preview, setPreview] = useState(false);
  const [history, setHistory] = useState(false);
  const [schedule, setSchedule] = useState(false);
  const [when, setWhen] = useState("");
  const [saveCount, setSaveCount] = useState(0);
  const mobile = useIsMobile();
  const client = useQueryClient();
  const docRef = useRef(doc);
  const dirty = useRef<Doc>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);

  const flush = useCallback(async (manual = false) => {
    if (timer.current) clearTimeout(timer.current);
    if (inFlight.current) { timer.current = setTimeout(() => flush(manual), 400); return; }
    const body = dirty.current;
    if (!Object.keys(body).length && !manual) return;
    dirty.current = {};
    inFlight.current = true;
    setSave("saving");
    try {
      const saved = await patch<Doc>(`/admin/contents/${docRef.current.id}/${manual ? "" : "?autosave=1"}`, body);
      if (saved.slug !== docRef.current.slug && !("slug" in dirty.current)) { docRef.current = { ...docRef.current, slug: saved.slug }; setDoc((d) => ({ ...d, slug: saved.slug })); }
      setSavedAt(Date.now()); setSaveCount((c) => c + 1);
      setSave(Object.keys(dirty.current).length ? "dirty" : "saved");
      client.invalidateQueries({ queryKey: ["/admin/contents/"] });
    } catch (e) {
      dirty.current = { ...body, ...dirty.current };
      setSave("error");
      toast.error((e as ApiError).message);
    } finally { inFlight.current = false; }
  }, [client]);
  const change = useCallback((p: Doc) => {
    const sendable = Object.fromEntries(Object.entries(p).filter(([k]) => SETTINGS_FIELDS.includes(k) || ["title", "subtitle", "body_json"].includes(k)));
    setDoc((d) => { const next = { ...d, ...p }; docRef.current = next; return next; });
    dirty.current = { ...dirty.current, ...sendable };
    setSave("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(), 2500);
  }, [flush]);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 5000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (Object.keys(dirty.current).length) { e.preventDefault(); e.returnValue = ""; } };
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); flush(true); } };
    addEventListener("keydown", key);
    return () => { removeEventListener("keydown", key); if (timer.current) clearTimeout(timer.current); };
  }, [flush]);
  const onBody = useCallback((body_json: object) => change({ body_json }), [change]);
  const status = useAction(async (v: { status: string; scheduled_for?: string }) => {
    await flush(true);
    return patch<Doc>(`/admin/contents/${docRef.current.id}/`, v);
  }, { success: (r) => (r.status === "published" ? "Published" : r.status === "scheduled" ? "Scheduled" : "Moved to drafts"), onSuccess: (r) => { setDoc((d) => ({ ...d, status: r.status, scheduled_for: r.scheduled_for })); setSchedule(false); } });
  const statusText = save === "saving" ? "Saving…" : save === "dirty" ? "Unsaved changes" : save === "error" ? "Not saved" : `Saved ${timeAgo(new Date(savedAt).toISOString())}`;
  const settings = <Panel doc={doc} set={change} />;
  const leave = (e: React.MouseEvent) => { if (Object.keys(dirty.current).length) flush(); e.stopPropagation(); };
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href="/admin/contents" onClick={leave} className="-ml-2 inline-flex h-9 items-center gap-1 rounded-md px-2 text-sm text-fg-2 hover:text-fg"><ChevronLeft className="size-4" aria-hidden />Content</Link>
        <Badge tone={doc.status === "published" ? "success" : doc.status === "scheduled" ? "info" : "neutral"}>{doc.status}</Badge>
        <span role="status" data-testid="save-status" className={cn("inline-flex items-center gap-1 text-[13px] text-fg-3", save === "error" && "text-danger")}>{save === "saving" && <Loader2 className="size-3 animate-spin" aria-hidden />}{statusText}</span>
        <div className="ml-auto flex items-center gap-1">
          <IconButton label="Revision history" onClick={() => setHistory(true)}><History /></IconButton>
          <IconButton label="Preview" onClick={async () => { await flush(); setPreview(true); }}><Eye /></IconButton>
          <IconButton label="Settings" className="lg:hidden" onClick={() => setPanel(true)}><Settings2 /></IconButton>
          <Button variant="secondary" loading={save === "saving" && !status.isPending} onClick={() => flush(true)}>Save</Button>
          {doc.status === "published" ? <Button variant="secondary" loading={status.isPending} onClick={() => status.mutate({ status: "draft" })}>Unpublish</Button> : (<>
            <IconButton label="Schedule" variant="secondary" onClick={() => setSchedule(true)}><Clock /></IconButton>
            <Button loading={status.isPending} onClick={() => status.mutate({ status: "published" })}>Publish</Button>
          </>)}
        </div>
      </div>
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-8">
        <div className="min-w-0">
          <div className="mx-auto max-w-[68ch]">
            <input aria-label="Title" placeholder="Title" value={doc.title === "Untitled" ? "" : doc.title} onChange={(e) => change({ title: e.target.value })} className="w-full bg-transparent text-[28px] font-semibold leading-tight tracking-tight outline-none placeholder:text-fg-3 md:text-4xl" />
            <input aria-label="Subtitle" placeholder="Subtitle" value={doc.subtitle} onChange={(e) => change({ subtitle: e.target.value })} className="mt-1 w-full bg-transparent pb-3 font-serif text-lg text-fg-2 outline-none placeholder:text-fg-3 md:text-xl" />
          </div>
          <RichEditor initial={initial.body_json && Object.keys(initial.body_json).length ? initial.body_json : { type: "doc", content: [{ type: "paragraph" }] }} onChange={onBody} contentId={initial.id} onStats={setWords} />
          <div className="mx-auto mt-6 flex max-w-[68ch] gap-3 border-t pt-2 text-[13px] text-fg-3"><span>{words.toLocaleString()} words</span><span>{Math.max(1, Math.ceil(words / 220))} min read</span></div>
        </div>
        {!mobile && <aside className="hidden lg:block"><Card className="sticky top-[72px] max-h-[calc(100dvh-88px)] overflow-y-auto p-4">{settings}</Card></aside>}
      </div>
      <Sheet open={panel && (mobile || true)} onOpenChange={setPanel} title="Content settings">{settings}</Sheet>
      <Preview open={preview} onOpenChange={setPreview} id={doc.id} saved={saveCount} />
      <Revisions open={history} onOpenChange={setHistory} id={doc.id} onRestore={reload} />
      <Sheet open={schedule} onOpenChange={setSchedule} title="Schedule publishing" size="sm" footer={<Button disabled={!when} loading={status.isPending} onClick={() => status.mutate({ status: "scheduled", scheduled_for: new Date(when).toISOString() })}>Schedule</Button>}>
        <Field label="Publish at"><Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
      </Sheet>
    </div>
  );
}
