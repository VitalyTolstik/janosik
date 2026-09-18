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
import { PlainTextCodeBlockEditor } from "@/components/editor/PlainTextCodeBlock";
import { janosikIconFor } from "@/components/editor/janosik-icons";

/**
 * Shared plugin set for the card-description MDXEditor instances.
 *
 * The curated feature set for a kanban card (TASK-2): headings, bold/italic,
 * strikethrough, inline code, links, bullet/numbered/check lists, quotes and
 * thematic breaks. Tables and images have no toolbar buttons on purpose —
 * the plugins stay enabled only so legacy markdown (seed data, imported JSON
 * from the TASK-1 era) keeps round-tripping without errors. Code blocks are
 * fully editable via the CodeMirror descriptor (TASK-21).
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
  codeBlockPlugin({
    defaultCodeBlockLanguage: "txt",
    // TASK-21: without any descriptor `MdastCodeVisitor.testNode` never
    // matches `code` mdast nodes — the import throws mid-document (truncated
    // content) and the library permanently mutes onChange (silent data loss:
    // edits stopped saving). The catch-all plain-text descriptor (see
    // PlainTextCodeBlock) makes code blocks importable and editable at
    // ~zero bundle cost; the stock CodeMirror editor would add ~430 KB.
    codeBlockEditorDescriptors: [
      { match: () => true, priority: 1, Editor: PlainTextCodeBlockEditor },
    ],
  }),
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
  // The "Link title" (HTML title attribute) field is noise for a kanban
  // card — the dialog keeps URL + anchor text (anchor text only shows up
  // when the cursor is collapsed, i.e. there is nothing to attach to).
  linkDialogPlugin({ showLinkTitleField: false }),
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

/** Read-only description (VIEWER, TASK-35): content only, no toolbar. */
export const descriptionViewerPlugins: RealmPlugin[] = [...contentPlugins];

/**
 * The comment composer's plugin set (TASK-37): the same content engine as
 * the description, but a compact toolbar — character formatting, lists and
 * links only. No block-type select and no undo buttons: a comment is short
 * prose, headings via markdown shortcuts still work for those who type them.
 */
export const commentEditorPlugins: RealmPlugin[] = [
  ...contentPlugins,
  toolbarPlugin({
    toolbarClassName: "janosik-mdx-toolbar",
    toolbarContents: () => (
      <>
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

export { editorTranslation, janosikIconFor };
