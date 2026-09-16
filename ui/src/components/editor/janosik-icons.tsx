import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Braces,
  Check,
  ChevronDown,
  Code,
  Copy,
  Ellipsis,
  EllipsisVertical,
  ExternalLink,
  FileCode,
  FileText,
  GitCompare,
  Highlighter,
  ImagePlus,
  Info,
  Italic,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Pencil,
  Redo2,
  Settings,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  Trash2,
  Type,
  Underline,
  Undo2,
  X,
} from "lucide-react";
import type { JSX } from "react";

import type { IconKey } from "@mdxeditor/editor";

/**
 * Lucide icon set for MDXEditor — replaces the built-in Material icons so the
 * toolbar matches the rest of the app (lucide is the Janosik icon language).
 *
 * Wired through the official `iconComponentFor` prop — no CSS/DOM hacks.
 * Icons inherit the current color and are sized by the editor CSS
 * (`.mdxeditor .lucide` rules in index.css).
 */
const ICONS: Record<IconKey, JSX.Element> = {
  undo: <Undo2 />,
  redo: <Redo2 />,
  format_bold: <Bold />,
  format_italic: <Italic />,
  format_underlined: <Underline />,
  code: <Code />,
  strikeThrough: <Strikethrough />,
  superscript: <Superscript />,
  subscript: <Subscript />,
  format_list_bulleted: <List />,
  format_list_numbered: <ListOrdered />,
  format_list_checked: <ListTodo />,
  format_highlight: <Highlighter />,
  link: <Link2 />,
  add_photo: <ImagePlus />,
  table: <Table />,
  horizontal_rule: <Minus />,
  frontmatter: <Braces />,
  frame_source: <FileCode />,
  arrow_drop_down: <ChevronDown />,
  admonition: <Info />,
  rich_text: <Type />,
  difference: <GitCompare />,
  markdown: <FileText />,
  open_in_new: <ExternalLink />,
  link_off: <Link2Off />,
  edit: <Pencil />,
  content_copy: <Copy />,
  more_horiz: <Ellipsis />,
  more_vert: <EllipsisVertical />,
  close: <X />,
  settings: <Settings />,
  delete_big: <Trash2 />,
  delete_small: <Minus />,
  format_align_center: <AlignCenter />,
  format_align_left: <AlignLeft />,
  format_align_right: <AlignRight />,
  add_row: <Minus />,
  add_column: <Minus />,
  insert_col_left: <Minus />,
  insert_row_above: <Minus />,
  insert_row_below: <Minus />,
  insert_col_right: <Minus />,
  check: <Check />,
};

export function janosikIconFor(name: IconKey): JSX.Element {
  return ICONS[name] ?? <Type />;
}
