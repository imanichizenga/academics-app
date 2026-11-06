"use client";
import CharacterCount from "@tiptap/extension-character-count";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import LinkExt from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import TextStyle from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import { BubbleMenu, EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { ArrowLeft, Ban, Bold, Code, Highlighter, Italic, Link2, List, ListOrdered, Minus, MoreHorizontal, Palette, Paperclip, Plus, Quote, Redo2, Replace, Strikethrough, Table2, Trash2, Underline as UnderlineIcon, Undo2, Unlink } from "lucide-react";
import { common, createLowlight } from "lowlight";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { MediaPicker, type PickedAsset } from "@/components/admin/media-picker";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger, Tooltip } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/form";
import { Sheet, useIsMobile } from "@/components/ui/overlay";
import { uploadFile } from "@/lib/upload";
import { cn, fileSize } from "@/lib/utils";
import { AudioEmbed, Callout, FigureImage, FileCardNode, FileLink, PdfEmbed, SlashCommands, VideoEmbed } from "./extensions";
import { slashItems, slashSuggestion, type PickerKind, type SlashItem } from "./slash";

const lowlight = createLowlight(common);
const COLORS = [["#DC2626", "Red"], ["#D97706", "Amber"], ["#15803D", "Green"], ["#2563EB", "Blue"], ["#7C3AED", "Violet"]];
// The stuck header (57) and toolbar (46) plus a gap. With the editor as the popper boundary, the bubble
// cannot cover the toolbar in either position: in the page's flow above the text, or stuck to the top.
const BUBBLE_TOP = 112;

function Tool({ label, active, onClick, disabled, children }: { label: string; active?: boolean; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <Tooltip content={label}>
      <button type="button" aria-label={label} aria-pressed={active} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick}
        className={cn("grid size-9 shrink-0 place-items-center rounded-md text-fg-2 hover:bg-surface-2 hover:text-fg disabled:opacity-40 [&_svg]:size-4", active && "bg-primary-soft text-primary-ink")}>{children}</button>
    </Tooltip>
  );
}
const Sep = () => <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-border" />;

/** Everything otherwise only reachable through "/". Runs the same commands as the slash menu. */
function MoreMenu({ editor, items }: { editor: Editor; items: SlashItem[] }) {
  const here = () => { const { from } = editor.state.selection; return { from, to: from }; };
  const blocks = ["Task list", "Info callout", "Tip callout", "Warning callout", "Code block"];
  const media = ["Image", "Video", "YouTube", "Audio", "PDF viewer", "File card"];
  const row = (title: string) => {
    const item = items.find((i) => i.title === title);
    return item && <DropdownItem key={title} onSelect={() => item.run(editor, here())}><item.icon />{title}</DropdownItem>;
  };
  return (
    <Dropdown>
      <DropdownTrigger asChild><button type="button" aria-label="More blocks" title="More blocks" className="grid size-9 shrink-0 place-items-center rounded-md text-fg-2 hover:bg-surface-2 hover:text-fg [&_svg]:size-4"><MoreHorizontal /></button></DropdownTrigger>
      <DropdownContent align="end" className="max-h-[60dvh] overflow-y-auto">
        <DropdownItem onSelect={() => editor.chain().focus().toggleStrike().run()}><Strikethrough />Strikethrough</DropdownItem>
        <DropdownItem onSelect={() => editor.chain().focus().toggleCode().run()}><Code />Inline code</DropdownItem>
        <DropdownSeparator />
        {blocks.map(row)}
        <DropdownSeparator />
        {media.map(row)}
      </DropdownContent>
    </Dropdown>
  );
}

function Toolbar({ editor, onPick, onLink, slash }: { editor: Editor; onPick: (k: PickerKind) => void; onLink: () => void; slash: SlashItem[] }) {
  const c = () => editor.chain().focus();
  return (
    <div role="toolbar" aria-label="Formatting" className="scroll-x sticky top-14 z-20 -mx-4 flex items-center gap-0.5 border-y bg-bg/95 px-3 py-1 backdrop-blur md:top-[57px] md:mx-0 md:rounded-lg md:border">
      <Tool label="Undo" disabled={!editor.can().undo()} onClick={() => c().undo().run()}><Undo2 /></Tool>
      <Tool label="Redo" disabled={!editor.can().redo()} onClick={() => c().redo().run()}><Redo2 /></Tool><Sep />
      {([2, 3, 4] as const).map((level) => <Tool key={level} label={`Heading ${level}`} active={editor.isActive("heading", { level })} onClick={() => c().toggleHeading({ level }).run()}><span className="text-xs font-bold">H{level}</span></Tool>)}<Sep />
      <Tool label="Bold" active={editor.isActive("bold")} onClick={() => c().toggleBold().run()}><Bold /></Tool>
      <Tool label="Italic" active={editor.isActive("italic")} onClick={() => c().toggleItalic().run()}><Italic /></Tool>
      <Tool label="Underline" active={editor.isActive("underline")} onClick={() => c().toggleUnderline().run()}><UnderlineIcon /></Tool>
      <Tool label="Highlight" active={editor.isActive("highlight")} onClick={() => c().toggleHighlight().run()}><Highlighter /></Tool>
      <Tool label="Link" active={editor.isActive("link")} onClick={onLink}><Link2 /></Tool><Sep />
      <Tool label="Bullet list" active={editor.isActive("bulletList")} onClick={() => c().toggleBulletList().run()}><List /></Tool>
      <Tool label="Numbered list" active={editor.isActive("orderedList")} onClick={() => c().toggleOrderedList().run()}><ListOrdered /></Tool>
      <Tool label="Quote" active={editor.isActive("blockquote")} onClick={() => c().toggleBlockquote().run()}><Quote /></Tool>
      <Tool label="Divider" onClick={() => c().setHorizontalRule().run()}><Minus /></Tool>
      <Tool label="Table" onClick={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 /></Tool>
      <Tool label="Insert image" onClick={() => onPick("image")}><Plus /></Tool>
      <MoreMenu editor={editor} items={slash} />
      {editor.isActive("table") && (<><Sep />
        <Button variant="ghost" size="sm" onClick={() => c().addRowAfter().run()}>+ Row</Button>
        <Button variant="ghost" size="sm" onClick={() => c().addColumnAfter().run()}>+ Column</Button>
        <Button variant="ghost" size="sm" onClick={() => c().deleteTable().run()}>Delete table</Button>
      </>)}
    </div>
  );
}

/** The actions for selected text, shared by the desktop bubble and the phone's bottom bar. */
function SelectionActions({ editor, onAttach, onLink, compact }: { editor: Editor; onAttach: () => void; onLink: () => void; compact?: boolean }) {
  const [colours, setColours] = useState(false);
  const hold = (e: React.MouseEvent) => e.preventDefault();
  const c = () => editor.chain().focus();
  const file = editor.isActive("fileLink") ? editor.getAttributes("fileLink") : null;
  if (file) return (<>
    <div className="flex min-w-0 items-center gap-1.5 px-2 text-[13px]"><Paperclip className="size-3.5 shrink-0 text-primary-ink" aria-hidden /><span className="max-w-40 truncate font-medium">{file.filename}</span><span className="shrink-0 text-fg-3">{fileSize(file.size)}</span></div>
    <Button variant="ghost" size="sm" onMouseDown={hold} onClick={onAttach}><Replace />Replace</Button>
    <Button variant="ghost" size="sm" onMouseDown={hold} onClick={() => c().extendMarkRange("fileLink").unsetMark("fileLink").run()}><Unlink />Remove</Button>
  </>);
  if (colours) return (<>
    <Tool label="Back" onClick={() => setColours(false)}><ArrowLeft /></Tool><Sep />
    {COLORS.map(([color, name]) => <Tool key={color} label={name} active={editor.isActive("textStyle", { color })} onClick={() => { c().setColor(color).run(); setColours(false); }}><span className="size-4 rounded-full" style={{ background: color }} /></Tool>)}
    <Tool label="Default colour" onClick={() => { c().unsetColor().run(); setColours(false); }}><Ban /></Tool>
  </>);
  return (<>
    <Button variant="soft" size="sm" className="shrink-0" onMouseDown={hold} onClick={onAttach}><Paperclip />Attach file</Button><Sep />
    <Tool label="Bold" active={editor.isActive("bold")} onClick={() => c().toggleBold().run()}><Bold /></Tool>
    <Tool label="Italic" active={editor.isActive("italic")} onClick={() => c().toggleItalic().run()}><Italic /></Tool>
    <Tool label="Underline" active={editor.isActive("underline")} onClick={() => c().toggleUnderline().run()}><UnderlineIcon /></Tool>
    {!compact && <Tool label="Strikethrough" active={editor.isActive("strike")} onClick={() => c().toggleStrike().run()}><Strikethrough /></Tool>}
    {!compact && <Tool label="Inline code" active={editor.isActive("code")} onClick={() => c().toggleCode().run()}><Code /></Tool>}
    <Tool label="Highlight" active={editor.isActive("highlight")} onClick={() => c().toggleHighlight().run()}><Highlighter /></Tool>
    <Tool label="Text colour" onClick={() => setColours(true)}><Palette /></Tool>
    <Tool label="Link" active={editor.isActive("link")} onClick={onLink}><Link2 /></Tool>
  </>);
}

/** Phones show their own selection menu near the text, so ours sits at the bottom, above the keyboard. */
function SelectionBar({ editor, onAttach, onLink }: { editor: Editor; onAttach: () => void; onLink: () => void }) {
  const [lift, setLift] = useState(0);
  const [, redraw] = useState(0);
  useEffect(() => {
    const view = window.visualViewport;
    if (!view) return;
    const on = () => setLift(Math.max(0, window.innerHeight - view.height - view.offsetTop));
    on();
    view.addEventListener("resize", on);
    view.addEventListener("scroll", on);
    return () => { view.removeEventListener("resize", on); view.removeEventListener("scroll", on); };
  }, []);
  useEffect(() => {
    const on = () => redraw((n) => n + 1);
    editor.on("selectionUpdate", on);
    editor.on("transaction", on);
    return () => { editor.off("selectionUpdate", on); editor.off("transaction", on); };
  }, [editor]);
  if (editor.state.selection.empty || editor.isActive("image")) return null;
  return (
    <div data-testid="selection-bar" className="safe-bottom fixed inset-x-0 z-40 border-t bg-surface shadow-lg" style={{ bottom: lift }}>
      <div className="scroll-x flex items-center gap-0.5 px-2 py-1.5">
        <SelectionActions compact editor={editor} onAttach={onAttach} onLink={onLink} />
      </div>
    </div>
  );
}

export function RichEditor({ initial, onChange, contentId, onStats }: { initial: object; onChange: (doc: object) => void; contentId: string; onStats: (words: number) => void }) {
  const [picker, setPicker] = useState<PickerKind | null>(null);
  const [attach, setAttach] = useState<{ from: number; to: number; text: string } | null>(null);
  const mobile = useIsMobile();
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [ytOpen, setYtOpen] = useState(false);
  const [ytUrl, setYtUrl] = useState("");
  const pickerRef = useRef(setPicker);
  const ytRef = useRef(() => setYtOpen(true));
  const editorRef = useRef<Editor | null>(null);

  const extensions = useMemo(() => [
    StarterKit.configure({ heading: { levels: [2, 3, 4] }, codeBlock: false }),
    Underline, Highlight.configure({ multicolor: true }), TextStyle, Color, LinkExt.configure({ openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"] }),
    Placeholder.configure({ placeholder: ({ node }) => (node.type.name === "heading" ? "Heading" : "Write, or press / for blocks…") }),
    TaskList, TaskItem.configure({ nested: false }), Table.configure({ resizable: false }), TableRow, TableHeader, TableCell,
    CodeBlockLowlight.configure({ lowlight }), CharacterCount, FileLink, Callout, FigureImage, VideoEmbed, AudioEmbed, PdfEmbed, FileCardNode,
    SlashCommands.configure({ suggestion: slashSuggestion(() => slashItems((k) => pickerRef.current(k), () => ytRef.current())) as never }),
  ], []);
  const uploadInline = async (file: File) => {
    const id = toast.loading(`Uploading ${file.name}`);
    try {
      const asset = await uploadFile(file, { content: contentId });
      if (asset) editorRef.current?.chain().focus().insertContent({ type: "image", attrs: { assetId: asset.id } }).run();
      toast.success("Image added", { id });
    } catch (e) { toast.error((e as Error).message, { id }); }
  };
  const editor = useEditor({
    extensions, content: initial, immediatelyRender: false,
    editorProps: {
      attributes: { class: "tiptap prose-reading measure mx-auto", "aria-label": "Lesson body", role: "textbox", "aria-multiline": "true" },
      handleDrop: (_, event) => { const f = (event as DragEvent).dataTransfer?.files?.[0]; if (f?.type.startsWith("image/")) { event.preventDefault(); uploadInline(f); return true; } return false; },
      handlePaste: (_, event) => { const f = event.clipboardData?.files?.[0]; if (f?.type.startsWith("image/")) { event.preventDefault(); uploadInline(f); return true; } return false; },
    },
    onUpdate: ({ editor: e }) => { onChange(e.getJSON()); onStats(e.storage.characterCount.words()); },
    onCreate: ({ editor: e }) => onStats(e.storage.characterCount.words()),
  });
  useEffect(() => { editorRef.current = editor; }, [editor]);
  const pick = (asset: PickedAsset) => {
    if (!editor || !picker) return;
    const attrs = picker === "image" ? { assetId: asset.id } : { assetId: asset.id, filename: asset.original_filename, size: asset.size };
    editor.chain().focus().insertContent({ type: picker, attrs }).run();
  };
  const startAttach = () => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    setAttach({ from, to, text: editor.state.doc.textBetween(from, to, " ") });
  };
  const attachAsset = (asset: PickedAsset) => {
    if (!editor || !attach) return;
    editor.chain().focus().setTextSelection({ from: attach.from, to: attach.to }).extendMarkRange("fileLink").setMark("fileLink", { assetId: asset.id, filename: asset.original_filename, size: asset.size }).run();
    setAttach(null);
    toast.success(`Attached ${asset.original_filename}`);
  };
  const openLink = () => { setLinkUrl(editor?.getAttributes("link").href ?? ""); setLinkOpen(true); };
  const saveLink = () => {
    if (!editor) return;
    const chain = editor.chain().focus().extendMarkRange("link");
    if (linkUrl) chain.setLink({ href: /^(https?:|mailto:|\/)/.test(linkUrl) ? linkUrl : `https://${linkUrl}` }).run(); else chain.unsetLink().run();
    setLinkOpen(false);
  };
  const saveYoutube = () => {
    const id = ytUrl.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{6,20})/)?.[1] ?? (/^[\w-]{6,20}$/.test(ytUrl) ? ytUrl : null);
    if (!id) { toast.error("That does not look like a YouTube link."); return; }
    editor?.chain().focus().insertContent({ type: "videoEmbed", attrs: { youtubeId: id } }).run();
    setYtOpen(false); setYtUrl("");
  };
  if (!editor) return <div className="skeleton h-96" />;
  const quoted = attach && attach.text.length > 40 ? `${attach.text.slice(0, 40).trimEnd()}…` : attach?.text;
  return (
    <div>
      <Toolbar editor={editor} onPick={setPicker} onLink={openLink} slash={slashItems(setPicker, () => setYtOpen(true))} />
      {/* A stable wrapper: tiptap moves BubbleMenu's node, so React must not insert a sibling before it. */}
      <div>{mobile && <SelectionBar editor={editor} onAttach={startAttach} onLink={openLink} />}</div>
      <BubbleMenu editor={editor} shouldShow={({ editor: e, state }) => !state.selection.empty && e.isEditable && !e.isActive("image") && matchMedia("(min-width: 768px)").matches}
        tippyOptions={{ duration: 120, maxWidth: "none", placement: "top", zIndex: 25, popperOptions: { modifiers: [
          { name: "flip", options: { boundary: editor.view.dom, padding: { top: BUBBLE_TOP, bottom: 8 } } },
          { name: "preventOverflow", options: { boundary: "clippingParents", rootBoundary: "viewport", altAxis: true, tether: false, padding: { top: BUBBLE_TOP, left: 8, right: 8, bottom: 8 } } },
        ] } }}>
        <div className="flex max-w-[calc(100vw-24px)] items-center gap-0.5 overflow-x-auto rounded-lg border bg-surface p-1 shadow-lg" data-testid="bubble-menu">
          <SelectionActions editor={editor} onAttach={startAttach} onLink={openLink} />
        </div>
      </BubbleMenu>
      <div className="mt-6"><EditorContent editor={editor} /></div>
      <MediaPicker open={!!attach} onOpenChange={(v) => { if (!v) setAttach(null); }} onPick={attachAsset} title={`Attach a file to “${quoted ?? ""}”`} contentId={contentId} />
      <MediaPicker open={!!picker} onOpenChange={(v) => { if (!v) setPicker(null); }} onPick={pick} contentId={contentId}
        title={picker === "image" ? "Add an image" : "Choose a file"} kinds={picker === "image" ? ["image"] : picker === "videoEmbed" ? ["video"] : picker === "audioEmbed" ? ["audio"] : picker === "pdfEmbed" ? ["pdf"] : undefined}
        accept={picker === "image" ? "image/*" : picker === "videoEmbed" ? "video/*" : picker === "audioEmbed" ? "audio/*" : picker === "pdfEmbed" ? ".pdf" : undefined} />
      <Sheet open={linkOpen} onOpenChange={setLinkOpen} title="Add a link" size="sm" footer={<div className="flex w-full justify-end gap-2"><Button variant="secondary" onClick={() => { setLinkUrl(""); editor.chain().focus().unsetLink().run(); setLinkOpen(false); }}><Trash2 />Remove</Button><Button onClick={saveLink}>Save</Button></div>}>
        <Field label="URL"><Input autoFocus value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveLink(); } }} /></Field>
      </Sheet>
      <Sheet open={ytOpen} onOpenChange={setYtOpen} title="Embed a YouTube video" size="sm" footer={<Button onClick={saveYoutube}>Embed</Button>}>
        <Field label="YouTube link"><Input autoFocus value={ytUrl} onChange={(e) => setYtUrl(e.target.value)} placeholder="https://youtube.com/watch?v=…" /></Field>
      </Sheet>
    </div>
  );
}
