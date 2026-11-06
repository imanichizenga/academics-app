"use client";
import { CheckCircle2, Pause, Play, RotateCw, X, XCircle } from "lucide-react";
import { IconButton } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/display";
import { cancelUpload, clearFinished, pauseUpload, resumeUpload, uploads } from "@/lib/upload";
import { fileSize } from "@/lib/utils";

const LABEL: Record<string, string> = { uploading: "Uploading", paused: "Paused", finishing: "Verifying", done: "Done", failed: "Failed", cancelled: "Cancelled", queued: "Queued" };

/** Uploads keep running while the teacher moves around the admin. */
export function UploadTray() {
  const { tasks } = uploads.use();
  if (!tasks.length) return null;
  return (
    <section aria-label="Uploads" className="safe-bottom fixed bottom-3 right-3 z-40 w-[calc(100vw-24px)] max-w-sm overflow-hidden rounded-xl border bg-surface shadow-lg">
      <div className="flex items-center justify-between border-b px-3 py-1.5 text-[13px] font-semibold">Uploads<IconButton label="Clear finished" size="icon-sm" onClick={clearFinished}><X /></IconButton></div>
      <ul className="max-h-56 divide-y overflow-y-auto">
        {tasks.map((t) => (
          <li key={t.id} className="p-3">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.name}</span>
              {t.status === "uploading" && <IconButton size="icon-sm" label="Pause upload" onClick={() => pauseUpload(t.id)}><Pause /></IconButton>}
              {t.status === "paused" && <IconButton size="icon-sm" label="Resume upload" onClick={() => resumeUpload(t.id)}><Play /></IconButton>}
              {["uploading", "paused"].includes(t.status) && <IconButton size="icon-sm" label="Cancel upload" onClick={() => cancelUpload(t.id)}><XCircle /></IconButton>}
              {t.status === "done" && <CheckCircle2 className="size-4 text-success" aria-hidden />}
              {t.status === "failed" && <RotateCw className="size-4 text-danger" aria-hidden />}
            </div>
            {t.status !== "done" && <ProgressBar className="mt-1.5" value={(t.loaded / (t.size || 1)) * 100} label={`Uploading ${t.name}`} />}
            <div className="mt-1 text-xs text-fg-3">{t.error ?? `${LABEL[t.status]} · ${fileSize(t.loaded)} of ${fileSize(t.size)}`}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
