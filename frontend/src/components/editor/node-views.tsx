"use client";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { AlignCenter, AlignLeft, AlignRight, FileText, Film, Headphones, Lightbulb, Info, Paperclip, TriangleAlert, Trash2, Youtube } from "lucide-react";
import { cn, fileSize } from "@/lib/utils";

const CALLOUTS = [{ v: "info", icon: Info, label: "Info" }, { v: "tip", icon: Lightbulb, label: "Tip" }, { v: "warning", icon: TriangleAlert, label: "Warning" }];

export function CalloutView({ node, updateAttributes }: NodeViewProps) {
  return (
    <NodeViewWrapper className="callout" data-variant={node.attrs.variant}>
      <div contentEditable={false} className="mb-1 flex gap-0.5">
        {CALLOUTS.map((c) => <button key={c.v} type="button" aria-label={c.label} title={c.label} onClick={() => updateAttributes({ variant: c.v })} className={cn("grid size-7 place-items-center rounded-md", node.attrs.variant === c.v ? "bg-black/10 dark:bg-white/15" : "opacity-50 hover:opacity-100")}><c.icon className="size-4" /></button>)}
      </div>
      <NodeViewContent />
    </NodeViewWrapper>
  );
}
export function ImageView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const { src, assetId, caption, alt, align } = node.attrs;
  return (
    <NodeViewWrapper as="figure" data-align={align} className={cn("relative font-sans", selected && "ring-2 ring-primary ring-offset-2 ring-offset-bg rounded-lg")}>
      <img src={src || `/api/v1/media/${assetId}/view/?w=960`} alt={alt} draggable={false} />
      <div contentEditable={false} className="mt-1.5 flex flex-wrap items-center gap-1">
        {[["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight]].map(([value, Icon]: any) => (
          <button key={value} type="button" aria-label={`Align ${value}`} onClick={() => updateAttributes({ align: value })} className={cn("grid size-8 place-items-center rounded-md text-fg-2 hover:bg-surface-2", align === value && "bg-surface-2 text-fg")}><Icon className="size-4" /></button>
        ))}
        <input aria-label="Caption" placeholder="Add a caption" value={caption} onChange={(e) => updateAttributes({ caption: e.target.value })} className="h-8 min-w-0 flex-1 rounded-md bg-transparent px-2 text-sm outline-none placeholder:text-fg-3 focus:bg-surface-2" />
        <input aria-label="Alt text" placeholder="Alt text" value={alt} onChange={(e) => updateAttributes({ alt: e.target.value })} className="h-8 w-28 rounded-md bg-transparent px-2 text-sm outline-none placeholder:text-fg-3 focus:bg-surface-2" />
        <button type="button" aria-label="Remove image" onClick={deleteNode} className="grid size-8 place-items-center rounded-md text-fg-2 hover:bg-danger-soft hover:text-danger"><Trash2 className="size-4" /></button>
      </div>
    </NodeViewWrapper>
  );
}
const EMBED: Record<string, { icon: typeof Film; label: string }> = { videoEmbed: { icon: Film, label: "Video" }, audioEmbed: { icon: Headphones, label: "Audio" }, pdfEmbed: { icon: FileText, label: "PDF viewer" }, fileCard: { icon: Paperclip, label: "File card" } };
export function AssetEmbedView({ node, deleteNode, selected }: NodeViewProps) {
  const meta = EMBED[node.type.name];
  const Icon = node.attrs.youtubeId ? Youtube : meta.icon;
  return (
    <NodeViewWrapper className={cn("my-4 flex items-center gap-3 rounded-xl border bg-surface-2 p-3 font-sans", selected && "ring-2 ring-primary")} data-drag-handle>
      <div className="grid size-10 place-items-center rounded-lg bg-primary-soft text-primary-ink"><Icon className="size-5" aria-hidden /></div>
      <div className="min-w-0 flex-1 text-sm"><div className="truncate font-medium">{node.attrs.youtubeId ? `YouTube · ${node.attrs.youtubeId}` : node.attrs.filename}</div><div className="text-[13px] text-fg-3">{meta.label}{node.attrs.size ? ` · ${fileSize(node.attrs.size)}` : ""}</div></div>
      <button type="button" aria-label="Remove" onClick={deleteNode} className="grid size-9 place-items-center rounded-md text-fg-2 hover:bg-danger-soft hover:text-danger"><Trash2 className="size-4" /></button>
    </NodeViewWrapper>
  );
}
