"use client";
import { create } from "./store";
import { api, post } from "./api";

export type Task = {
  id: string; name: string; size: number; loaded: number; status: "queued" | "uploading" | "paused" | "finishing" | "done" | "failed" | "cancelled"; error?: string; assetId?: string;
};
const CONCURRENCY = 3;
const RETRIES = 3;

export const uploads = create<{ tasks: Task[] }>({ tasks: [] });
const patchTask = (id: string, p: Partial<Task>) => uploads.set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...p } : t)) }));
const controls = new Map<string, { paused: boolean; cancelled: boolean; aborts: Set<XMLHttpRequest>; resume?: () => void; assetId?: string }>();

function putPart(url: string, blob: Blob, onProgress: (n: number) => void, control: { aborts: Set<XMLHttpRequest> }) {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    control.aborts.add(xhr);
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      control.aborts.delete(xhr);
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.getResponseHeader("ETag") ?? "");
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => { control.aborts.delete(xhr); reject(new Error("Network error")); };
    xhr.onabort = () => { control.aborts.delete(xhr); reject(new Error("aborted")); };
    xhr.send(blob);
  });
}

/** Presigned multipart: parallel chunks, per-chunk retry, pause and cancel. The same flow for S3 and local storage. */
export async function uploadFile(file: File, opts: { content?: string; replaces?: string } = {}) {
  const id = crypto.randomUUID();
  const control: { paused: boolean; cancelled: boolean; aborts: Set<XMLHttpRequest>; resume?: () => void; assetId?: string } = { paused: false, cancelled: false, aborts: new Set() };
  controls.set(id, control);
  uploads.set((s) => ({ tasks: [{ id, name: file.name, size: file.size, loaded: 0, status: "uploading" }, ...s.tasks] }));
  try {
    const init = await post<{ id: string; part_size: number; part_count: number }>("/admin/media/", { filename: file.name, size: file.size, mime: file.type, content: opts.content, replaces: opts.replaces });
    control.assetId = init.id;
    patchTask(id, { assetId: init.id });
    const progress = new Map<number, number>();
    const report = () => patchTask(id, { loaded: [...progress.values()].reduce((a, b) => a + b, 0) });
    const etags: { part: number; etag: string }[] = [];
    const queue = Array.from({ length: init.part_count }, (_, i) => i + 1);
    const waitWhilePaused = () => (control.paused ? new Promise<void>((r) => { control.resume = r; }) : Promise.resolve());
    const worker = async () => {
      for (;;) {
        await waitWhilePaused();
        if (control.cancelled) return;
        const part = queue.shift();
        if (part == null) return;
        const blob = file.slice((part - 1) * init.part_size, part * init.part_size);
        for (let attempt = 1; ; attempt++) {
          try {
            const { urls } = await post<{ urls: Record<string, string> }>(`/admin/media/${init.id}/sign-parts/`, { parts: [part] });
            const etag = await putPart(urls[part], blob, (n) => { progress.set(part, n); report(); }, control);
            progress.set(part, blob.size); report();
            etags.push({ part, etag });
            break;
          } catch (e) {
            if (control.cancelled) return;
            progress.set(part, 0);
            if (control.paused) { await waitWhilePaused(); attempt = 0; continue; }
            if (attempt >= RETRIES) throw e;
            await new Promise((r) => setTimeout(r, 800 * attempt));
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, init.part_count) }, worker));
    if (control.cancelled) { await post(`/admin/media/${init.id}/abort/`).catch(() => {}); patchTask(id, { status: "cancelled" }); return null; }
    patchTask(id, { status: "finishing" });
    const asset = await post(`/admin/media/${init.id}/complete/`, { parts: etags });
    patchTask(id, { status: "done", loaded: file.size });
    controls.delete(id);
    return asset;
  } catch (e) {
    patchTask(id, { status: "failed", error: (e as Error).message });
    throw e;
  }
}
export function pauseUpload(id: string) {
  const c = controls.get(id);
  if (!c) return;
  c.paused = true;
  patchTask(id, { status: "paused" });
  c.aborts.forEach((x) => x.abort());
}
export function resumeUpload(id: string) {
  const c = controls.get(id);
  if (!c) return;
  c.paused = false;
  patchTask(id, { status: "uploading" });
  c.resume?.();
}
export function cancelUpload(id: string) {
  const c = controls.get(id);
  if (!c) return;
  c.cancelled = true; c.paused = false;
  c.aborts.forEach((x) => x.abort());
  c.resume?.();
  patchTask(id, { status: "cancelled" });
}
export const clearFinished = () => uploads.set((s) => ({ tasks: s.tasks.filter((t) => !["done", "cancelled"].includes(t.status)) }));
export const fetchAsset = (id: string) => api(`/admin/media/${id}/`);
