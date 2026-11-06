import { Mark, Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";
import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { AssetEmbedView, CalloutView, ImageView } from "./node-views";

/** The key mark: attaches a media asset to a run of text. Students click it to download. */
export const FileLink = Mark.create({
  name: "fileLink",
  inclusive: false,
  addAttributes() {
    return {
      assetId: { default: null, parseHTML: (el) => el.getAttribute("data-asset-id") },
      filename: { default: "", parseHTML: (el) => el.getAttribute("data-filename") },
      size: { default: 0, parseHTML: (el) => Number(el.getAttribute("data-size")) },
    };
  },
  parseHTML() { return [{ tag: "a[data-file-link]" }]; },
  renderHTML({ HTMLAttributes: a }) {
    return ["a", { class: "file-link", "data-file-link": "true", "data-asset-id": a.assetId, "data-filename": a.filename, "data-size": a.size, title: a.filename }, 0];
  },
});

export const Callout = Node.create({
  name: "callout", group: "block", content: "block+", defining: true,
  addAttributes() { return { variant: { default: "info", parseHTML: (el) => el.getAttribute("data-variant") } }; },
  parseHTML() { return [{ tag: "div.callout" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes({ class: "callout", "data-variant": HTMLAttributes.variant }), 0]; },
  addNodeView() { return ReactNodeViewRenderer(CalloutView); },
});

export const FigureImage = Node.create({
  name: "image", group: "block", atom: true, draggable: true,
  addAttributes() { return { assetId: { default: null }, src: { default: "" }, alt: { default: "" }, caption: { default: "" }, align: { default: "center" } }; },
  parseHTML() { return [{ tag: "figure[data-image]" }]; },
  renderHTML({ HTMLAttributes }) { return ["figure", mergeAttributes({ "data-image": "" }, HTMLAttributes)]; },
  addNodeView() { return ReactNodeViewRenderer(ImageView); },
});

function embed(name: string) {
  return Node.create({
    name, group: "block", atom: true, draggable: true,
    addAttributes() { return { assetId: { default: null }, youtubeId: { default: null }, filename: { default: "" }, size: { default: 0 } }; },
    parseHTML() { return [{ tag: `div[data-node="${name}"]` }]; },
    renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes({ "data-node": name }, HTMLAttributes)]; },
    addNodeView() { return ReactNodeViewRenderer(AssetEmbedView); },
  });
}
export const VideoEmbed = embed("videoEmbed");
export const AudioEmbed = embed("audioEmbed");
export const PdfEmbed = embed("pdfEmbed");
export const FileCardNode = embed("fileCard");

export const SlashCommands = Extension.create<{ suggestion: Omit<SuggestionOptions, "editor"> }>({
  name: "slashCommands",
  addOptions() { return { suggestion: { char: "/", pluginKey: new PluginKey("slash") } as Omit<SuggestionOptions, "editor"> }; },
  addProseMirrorPlugins() { return [Suggestion({ editor: this.editor, ...this.options.suggestion })]; },
});
