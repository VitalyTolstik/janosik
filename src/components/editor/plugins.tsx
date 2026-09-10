import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CodeToggle,
  CreateLink,
  ListsToggle,
  StrikeThroughSupSubToggles,
  UndoRedo,
  Separator,
  codeBlockPlugin,
  headingsPlugin,
  imagePlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  type RealmPlugin,
} from "@mdxeditor/editor";

import { editorTranslation } from "@/components/editor/editor-i18n";
import { janosikIconFor } from "@/components/editor/janosik-icons";

/**
 * Shared plugin set for the card-description MDXEditor instances.
 *
 * The curated feature set for a kanban card (TASK-2): headings, bold/italic,
 * strikethrough, inline code, links, bullet/numbered/check lists, quotes and
 * thematic breaks. Tables, code blocks and images have no toolbar buttons on
 * purpose — the plugins stay enabled only so legacy markdown (seed data,
 * imported JSON from the TASK-1 era) keeps round-tripping without errors.
 *
 * Raw HTML is never rendered: `suppressHtmlProcessing` keeps HTML tags as
 * literal text, so pasted/imported markup can't inject anything.
 *
 * The arrays are module-level singletons: MDXEditor warns when plugins are
 * re-created on every render, and the descriptors are stateless — safe to
 * share between instances (each editor applies them into its own realm).
 */

/** Plugins that parse/serialize content — used by both edit and read-only. */
const contentPlugins: RealmPlugin[] = [
  headingsPlugin(),
  listsPlugin(),
  quotePlugin(),
  linkPlugin(),
  markdownShortcutPlugin(),
  codeBlockPlugin({ defaultCodeBlockLanguage: "txt" }),
  imagePlugin({
    disableImageResize: true,
    disableImageSettingsButton: true,
    allowSetImageDimensions: false,
  }),
  tablePlugin(),
  thematicBreakPlugin(),
];

/** Toolbar + link dialog — edit mode only (read-only previews skip the UI). */
const uiPlugins: RealmPlugin[] = [
  linkDialogPlugin(),
  toolbarPlugin({
    toolbarClassName: "janosik-mdx-toolbar",
    toolbarContents: () => (
      <>
        <UndoRedo />
        <Separator />
        <BlockTypeSelect />
        <Separator />
        <BoldItalicUnderlineToggles options={["Bold", "Italic"]} />
        <StrikeThroughSupSubToggles options={["Strikethrough"]} />
        <CodeToggle />
        <Separator />
        <ListsToggle options={["bullet", "number", "check"]} />
        <CreateLink />
      </>
    ),
  }),
];

export const descriptionEditorPlugins: RealmPlugin[] = [
  ...contentPlugins,
  ...uiPlugins,
];

export const descriptionPreviewPlugins: RealmPlugin[] = contentPlugins;

export { editorTranslation, janosikIconFor };
