"use client";
import { UploadCloud } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

export function FileDropzone({ onFiles, accept, multiple, label, hint, className }: { onFiles: (files: File[]) => void; accept?: string; multiple?: boolean; label?: string; hint?: string; className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <button
      type="button"
      onClick={() => input.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onFiles(Array.from(e.dataTransfer.files)); }}
      className={cn("no-press flex w-full flex-col items-center rounded-xl border-2 border-dashed border-border-strong px-4 py-7 text-center hover:border-primary hover:bg-primary-soft", over && "border-primary bg-primary-soft", className)}
    >
      <UploadCloud className="mb-2 size-6 text-fg-3" aria-hidden />
      <span className="text-sm font-medium">{label ?? "Drop files here, or click to browse"}</span>
      {hint && <span className="mt-0.5 text-[13px] text-fg-3">{hint}</span>}
      <input ref={input} type="file" hidden accept={accept} multiple={multiple} data-testid="file-input"
        onChange={(e) => { onFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
    </button>
  );
}
