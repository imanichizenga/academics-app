"use client";
import parse, { Element, domToReact, type DOMNode } from "html-react-parser";
import { Download, FileIcon, Loader2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api";
import { useSite, useT } from "@/lib/providers";
import { fileSize } from "@/lib/utils";
import { defaultPlan, useCheckout } from "./checkout";
import { AudioPlayer } from "./audio";

const VideoPlayer = dynamic(() => import("./video").then((m) => m.VideoPlayer), { ssr: false, loading: () => <div className="skeleton aspect-video rounded-xl" /> });
const PdfViewer = dynamic(() => import("./pdf").then((m) => m.PdfViewer), { ssr: false, loading: () => <div className="skeleton h-96 rounded-xl" /> });

/** The whole click path for an attached file: signed URL on access, paywall sheet when locked. */
export function useFileDownload() {
  const { open } = useCheckout();
  const site = useSite();
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const start = useCallback(async (assetId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const { url } = await api<{ url: string }>(`/media/${assetId}/download/`);
      const link = document.createElement("a");
      link.href = url;
      link.rel = "noopener";
      document.body.append(link);
      link.click();
      link.remove();
    } catch (e) {
      const error = e as ApiError;
      const item = error.data.content as { id: string; slug: string; title: string; price: number | null; included_in_subscription: boolean } | undefined;
      const plan = item?.included_in_subscription && site.checkout_available ? defaultPlan(site.plans) : undefined;
      if (error.code !== "paywall") toast.error(error.message);
      else if (item?.price != null) open({ type: "content", id: item.id, title: item.title, price: item.price, slug: item.slug });
      else if (plan) open({ type: "plan", id: plan.id, title: t.pricing.planTitle(plan.name), price: plan.effective_price, days: plan.duration_days });
      else {
        toast(t.lesson.unlockFile);
        document.getElementById("paywall")?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    } finally { setBusy(false); }
  }, [busy, open, site, t]);
  return { start, busy };
}

function FileLink({ assetId, filename, size, children }: { assetId: string; filename: string; size: number; children: ReactNode }) {
  const { start, busy } = useFileDownload();
  return (
    <a href={`/api/v1/media/${assetId}/download/`} className="file-link" data-file-link title={`${filename} · ${fileSize(size)}`} aria-busy={busy || undefined}
      onClick={(e) => { e.preventDefault(); start(assetId); }}>
      {children}
      {busy ? <Loader2 className="ml-1 inline size-[0.9em] animate-spin align-[-0.1em]" aria-hidden /> : <Download className="ml-1 inline size-[0.85em] align-[-0.1em]" aria-hidden />}
    </a>
  );
}
export function FileCard({ assetId, filename, size, kind }: { assetId: string; filename: string; size: number; kind: string }) {
  const { start, busy } = useFileDownload();
  const { t } = useT();
  return (
    <div className="not-prose flex items-center gap-3 rounded-xl border bg-surface p-3 font-sans">
      <div className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-ink"><FileIcon className="size-5" aria-hidden /></div>
      <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{filename}</div><div className="text-[13px] text-fg-3">{kind.toUpperCase()} · {fileSize(size)}</div></div>
      <Button variant="secondary" size="sm" loading={busy} onClick={() => start(assetId)}><Download />{t.lesson.download}</Button>
    </div>
  );
}
export function BodyRenderer({ html, slug }: { html: string; slug?: string }) {
  return useMemo(() => parse(html, {
    replace(node) {
      if (!(node instanceof Element)) return undefined;
      const a = node.attribs;
      if (node.name === "a" && a["data-file-link"]) {
        return <FileLink assetId={a["data-asset-id"]} filename={a["data-filename"]} size={Number(a["data-size"])}>{domToReact(node.children as DOMNode[])}</FileLink>;
      }
      if (node.name === "div" && a["data-embed"]) {
        const id = a["data-asset-id"];
        switch (a["data-embed"]) {
          case "video": return <div className="not-prose my-6"><VideoPlayer assetId={id} /></div>;
          case "audio": return <div className="not-prose my-6"><AudioPlayer assetId={id} title={a["data-filename"]} /></div>;
          case "pdf": return <div className="not-prose my-6"><PdfViewer assetId={id} slug={slug} /></div>;
          case "file": return <div className="my-6"><FileCard assetId={id} filename={a["data-filename"]} size={Number(a["data-size"])} kind={a["data-kind"]} /></div>;
          case "youtube": return (
            <div className="my-6 aspect-video overflow-hidden rounded-xl">
              <iframe title="YouTube video" className="size-full" allowFullScreen loading="lazy" referrerPolicy="strict-origin-when-cross-origin" src={`https://www.youtube-nocookie.com/embed/${a["data-youtube-id"]}`} />
            </div>
          );
        }
      }
      return undefined;
    },
  }), [html, slug]);
}
