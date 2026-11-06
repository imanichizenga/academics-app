"use client";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { IconButton } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/display";
import { api } from "@/lib/api";
import { useT } from "@/lib/providers";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

export function PdfViewer({ assetId }: { assetId: string; slug?: string }) {
  const { t } = useT();
  const { data } = useQuery({ queryKey: ["preview", assetId], queryFn: () => api<{ url: string; preview: boolean; pages?: number; total_pages?: number }>(`/media/${assetId}/preview/`) });
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div data-testid="pdf-viewer" className="overflow-hidden rounded-xl border bg-surface-2 font-sans">
      <div className="sticky top-14 z-10 flex items-center justify-between gap-2 border-b bg-surface px-2 py-1 md:top-16">
        <div className="flex items-center">
          <IconButton size="icon-sm" label={t.player.prevPage} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft /></IconButton>
          <span className="px-1 text-[13px] tabular-nums text-fg-2">{page} / {pages || "–"}{data?.preview && data.total_pages ? ` of ${data.total_pages}` : ""}</span>
          <IconButton size="icon-sm" label={t.player.nextPage} disabled={page >= pages} onClick={() => setPage((p) => p + 1)}><ChevronRight /></IconButton>
        </div>
        <div className="flex items-center">
          <IconButton size="icon-sm" label={t.player.zoomOut} disabled={zoom <= 0.6} onClick={() => setZoom((z) => z - 0.2)}><ZoomOut /></IconButton>
          <span className="w-11 text-center text-[13px] tabular-nums text-fg-2">{Math.round(zoom * 100)}%</span>
          <IconButton size="icon-sm" label={t.player.zoomIn} disabled={zoom >= 2} onClick={() => setZoom((z) => z + 0.2)}><ZoomIn /></IconButton>
        </div>
      </div>
      <div ref={box} className="overflow-auto p-2 md:p-4">
        {data ? (
          <Document file={data.url} onLoadSuccess={({ numPages }) => setPages(numPages)} loading={<Skeleton className="h-[60vh]" />} error={<p className="p-6 text-center text-sm text-fg-2">{t.player.pdfError}</p>}>
            <Page pageNumber={page} width={Math.max(240, width - 8) * zoom} className="mx-auto w-fit shadow-md" loading={<Skeleton className="h-[60vh]" />} />
          </Document>
        ) : <Skeleton className="h-[60vh]" />}
      </div>
    </div>
  );
}
