"use client";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileIcon, FileSearch, Film, Headphones, Image as ImageIcon, Loader2, Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useDebounced } from "@/components/ui/data-table";
import { Tabs, EmptyState, ProgressBar, Skeleton } from "@/components/ui/display";
import { FileDropzone } from "@/components/ui/dropzone";
import { Input } from "@/components/ui/form";
import { Sheet } from "@/components/ui/overlay";
import { ApiError, api } from "@/lib/api";
import type { Media, Paged } from "@/lib/types";
import { uploadFile, uploads } from "@/lib/upload";
import { fileSize } from "@/lib/utils";

export const KIND_ICON: Record<string, typeof FileIcon> = { video: Film, audio: Headphones, image: ImageIcon };
export type PickedAsset = Media & { usage_count?: number };

export function AssetThumb({ asset, className }: { asset: PickedAsset; className?: string }) {
  const Icon = KIND_ICON[asset.kind] ?? FileIcon;
  return asset.thumbnail_url ? <img src={asset.thumbnail_url} alt="" className={`object-cover ${className}`} loading="lazy" /> : <div className={`grid place-items-center bg-primary-soft text-primary-ink ${className}`}><Icon className="size-5" aria-hidden /></div>;
}

/** Upload a new file or pick one from the library. Shared by the fileLink mark and every embed. */
export function MediaPicker({ open, onOpenChange, onPick, kinds, title, accept, contentId }: { open: boolean; onOpenChange: (v: boolean) => void; onPick: (a: PickedAsset) => void; kinds?: string[]; title: string; accept?: string; contentId?: string }) {
  const [tab, setTab] = useState("upload");
  const [term, setTerm] = useState("");
  const debounced = useDebounced(term);
  const client = useQueryClient();
  const tasks = uploads.use().tasks;
  const [busy, setBusy] = useState<string | null>(null);
  const qs = new URLSearchParams({ page_size: "24", search: debounced, status: "ready" });
  if (kinds?.length === 1) qs.set("kind", kinds[0]);
  const { data, isLoading } = useQuery({ queryKey: ["media", "pick", qs.toString()], enabled: open && tab === "library", placeholderData: keepPreviousData, queryFn: () => api<Paged<PickedAsset>>(`/admin/media/?${qs}`) });
  const rows = (data?.results ?? []).filter((a) => !kinds || kinds.includes(a.kind));
  const upload = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setBusy(file.name);
    try {
      const asset = await uploadFile(file, { content: contentId });
      client.invalidateQueries({ queryKey: ["media"] });
      if (asset) { onPick(asset); onOpenChange(false); }
    } catch (e) { toast.error((e as ApiError).message); } finally { setBusy(null); }
  };
  const task = tasks.find((t) => t.name === busy);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} size="lg">
      <Tabs className="mb-4" value={tab} onChange={setTab} items={[{ value: "upload", label: "Upload new" }, { value: "library", label: "Media library" }]} />
      {tab === "upload" ? (busy ? (
        <div className="rounded-xl border p-5" data-testid="upload-progress">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium"><Loader2 className="size-4 animate-spin text-primary-ink" aria-hidden /><span className="truncate">{busy}</span></div>
          <ProgressBar value={task ? (task.loaded / task.size) * 100 : 0} label="Upload progress" />
          <div className="mt-1.5 text-[13px] text-fg-3">{task ? `${fileSize(task.loaded)} of ${fileSize(task.size)}` : "Starting…"}</div>
        </div>
      ) : <FileDropzone onFiles={upload} accept={accept} hint="PDF, Word, PowerPoint, Excel, EPUB, images, audio or video" />) : (
        <div className="space-y-3">
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" aria-hidden /><Input aria-label="Search files" className="pl-9" placeholder="Search files" value={term} onChange={(e) => setTerm(e.target.value)} /></div>
          {isLoading ? <Skeleton className="h-40" /> : rows.length === 0 ? <EmptyState icon={FileSearch} title="No files found" text="Upload a file to see it here." /> : (
            <ul className="max-h-[46vh] divide-y overflow-y-auto rounded-xl border">
              {rows.map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => { onPick(a); onOpenChange(false); }} className="flex min-h-14 w-full items-center gap-3 p-2.5 text-left hover:bg-surface-2">
                    <AssetThumb asset={a} className="size-10 shrink-0 rounded-md" />
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{a.original_filename}</span><span className="text-[13px] text-fg-3">{a.kind.toUpperCase()} · {fileSize(a.size)}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Sheet>
  );
}
