"use client";
import type { Editor, Range } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import type { SuggestionProps } from "@tiptap/suggestion";
import { CheckSquare, Code2, FileText, Film, Heading2, Heading3, Heading4, Headphones, Image, Info, Lightbulb, List, ListOrdered, Minus, Paperclip, Quote, Table, TriangleAlert, Youtube } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import tippy, { type Instance } from "tippy.js";
import { cn } from "@/lib/utils";

export type PickerKind = "image" | "videoEmbed" | "audioEmbed" | "pdfEmbed" | "fileCard";
export type SlashItem = { title: string; hint: string; icon: typeof Info; keywords?: string; run: (e: Editor, r: Range) => void };

export function slashItems(openPicker: (kind: PickerKind) => void, askYoutube: () => void): SlashItem[] {
  const block = (fn: (e: Editor) => void) => (e: Editor, r: Range) => { e.chain().focus().deleteRange(r).run(); fn(e); };
  const callout = (variant: string) => block((e) => e.chain().insertContent({ type: "callout", attrs: { variant }, content: [{ type: "paragraph" }] }).run());
  return [
    { title: "Heading 2", hint: "Section title", icon: Heading2, keywords: "h2", run: block((e) => e.chain().setHeading({ level: 2 }).run()) },
    { title: "Heading 3", hint: "Subsection", icon: Heading3, keywords: "h3", run: block((e) => e.chain().setHeading({ level: 3 }).run()) },
    { title: "Heading 4", hint: "Small heading", icon: Heading4, keywords: "h4", run: block((e) => e.chain().setHeading({ level: 4 }).run()) },
    { title: "Bullet list", hint: "Simple list", icon: List, run: block((e) => e.chain().toggleBulletList().run()) },
    { title: "Numbered list", hint: "Ordered steps", icon: ListOrdered, run: block((e) => e.chain().toggleOrderedList().run()) },
    { title: "Task list", hint: "Checklist", icon: CheckSquare, keywords: "todo", run: block((e) => e.chain().toggleTaskList().run()) },
    { title: "Quote", hint: "Blockquote", icon: Quote, run: block((e) => e.chain().toggleBlockquote().run()) },
    { title: "Info callout", hint: "Highlighted note", icon: Info, run: callout("info") },
    { title: "Tip callout", hint: "Helpful advice", icon: Lightbulb, run: callout("tip") },
    { title: "Warning callout", hint: "Common mistake", icon: TriangleAlert, run: callout("warning") },
    { title: "Code block", hint: "With highlighting", icon: Code2, run: block((e) => e.chain().toggleCodeBlock().run()) },
    { title: "Divider", hint: "Horizontal line", icon: Minus, keywords: "hr", run: block((e) => e.chain().setHorizontalRule().run()) },
    { title: "Table", hint: "3 × 3 grid", icon: Table, run: block((e) => e.chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()) },
    { title: "Image", hint: "Upload or choose", icon: Image, keywords: "photo picture", run: block(() => openPicker("image")) },
    { title: "Video", hint: "From your library", icon: Film, run: block(() => openPicker("videoEmbed")) },
    { title: "YouTube", hint: "Embed by link", icon: Youtube, run: block(() => askYoutube()) },
    { title: "Audio", hint: "From your library", icon: Headphones, run: block(() => openPicker("audioEmbed")) },
    { title: "PDF viewer", hint: "Readable in the page", icon: FileText, run: block(() => openPicker("pdfEmbed")) },
    { title: "File card", hint: "Download card", icon: Paperclip, keywords: "attachment", run: block(() => openPicker("fileCard")) },
  ];
}

type ListProps = { items: SlashItem[]; command: (item: SlashItem) => void };
const List_ = forwardRef<{ onKeyDown: (e: KeyboardEvent) => boolean }, ListProps>(function SlashList({ items, command }, ref) {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [items]);
  useImperativeHandle(ref, () => ({
    onKeyDown(e) {
      if (e.key === "ArrowDown") { setIndex((i) => (i + 1) % items.length); return true; }
      if (e.key === "ArrowUp") { setIndex((i) => (i - 1 + items.length) % items.length); return true; }
      if (e.key === "Enter" && items[index]) { command(items[index]); return true; }
      return false;
    },
  }));
  if (!items.length) return <div className="rounded-lg border bg-surface p-3 text-sm text-fg-3 shadow-lg">No results</div>;
  return (
    <div role="listbox" aria-label="Insert block" className="max-h-80 w-64 overflow-y-auto rounded-lg border bg-surface p-1 shadow-lg">
      {items.map((item, i) => (
        <button key={item.title} role="option" aria-selected={i === index} type="button" onMouseEnter={() => setIndex(i)} onClick={() => command(item)} className={cn("flex w-full items-center gap-2.5 rounded-md p-1.5 text-left", i === index && "bg-surface-2")}>
          <span className="grid size-8 place-items-center rounded-md border bg-surface text-fg-2"><item.icon className="size-4" aria-hidden /></span>
          <span className="min-w-0"><span className="block text-sm font-medium">{item.title}</span><span className="block truncate text-xs text-fg-3">{item.hint}</span></span>
        </button>
      ))}
    </div>
  );
});

export function slashSuggestion(getItems: () => SlashItem[]) {
  return {
    char: "/", startOfLine: false,
    command: ({ editor, range, props }: { editor: Editor; range: Range; props: SlashItem }) => props.run(editor, range),
    items: ({ query }: { query: string }) => {
      const q = query.toLowerCase();
      return getItems().filter((i) => `${i.title} ${i.keywords ?? ""}`.toLowerCase().includes(q));
    },
    render: () => {
      let view: ReactRenderer<{ onKeyDown: (e: KeyboardEvent) => boolean }, ListProps>;
      let popup: Instance;
      return {
        onStart(props: SuggestionProps<SlashItem>) {
          view = new ReactRenderer(List_, { props, editor: props.editor });
          popup = tippy(document.body, { getReferenceClientRect: props.clientRect as () => DOMRect, appendTo: () => document.body, content: view.element, showOnCreate: true, interactive: true, trigger: "manual", placement: "bottom-start", arrow: false, theme: "none" });
        },
        onUpdate(props: SuggestionProps<SlashItem>) { view.updateProps(props); popup.setProps({ getReferenceClientRect: props.clientRect as () => DOMRect }); },
        onKeyDown(props: { event: KeyboardEvent }) {
          if (props.event.key === "Escape") { popup.hide(); return true; }
          return view.ref?.onKeyDown(props.event) ?? false;
        },
        onExit() { popup.destroy(); view.destroy(); },
      };
    },
  };
}
