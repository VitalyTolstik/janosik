import "@mdxeditor/editor/style.css";

import { MDXEditor } from "@mdxeditor/editor";

import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { sanitizeMarkdownForImport } from "@/utils/sanitizeMarkdown";
import {
  descriptionEditorPlugins,
  editorTranslation,
  janosikIconFor,
} from "@/components/editor/plugins";

interface DescriptionEditorProps {
  /** Current markdown — treated as the initial value (like a defaultValue). */
  value: string;
  /** Fired on every edit; `updateCard` handles persistence/debounce. */
  onChange: (markdown: string) => void;
  /** Shown when the description is empty. */
  placeholder?: string;
  className?: string;
}

/**
 * WYSIWYG markdown editor for the card description (MDXEditor).
 *
 * The dialog remounts the editor for every card (`key={cardId}` upstream),
 * so the `value` prop is read once on mount — afterwards the editor owns its
 * state and streams changes up through `onChange`. Normalization-only
 * emissions (whitespace/bullet char fixes on mount) are dropped so that
 * merely opening a card doesn't dirty `updatedAt`. Incoming markdown is
 * stripped of raw HTML first (see `sanitizeMarkdownForImport`) — the image
 * plugin's HTML visitor has an `innerHTML` sink that `suppressHtmlProcessing`
 * does not cover.
 *
 * Theming, typography and the lucide icon set live in index.css under the
 * `janosik-mdx` class; both themes come from the design tokens automatically.
 */
export function DescriptionEditor({
  value,
  onChange,
  placeholder,
  className,
}: DescriptionEditorProps) {
  const { lang } = useI18n();

  return (
    <MDXEditor
      // Re-key on language change so toolbar tooltips/labels re-resolve.
      key={lang}
      className={cn("janosik-mdx janosik-mdx-edit", className)}
      contentEditableClassName="janosik-md-content"
      markdown={sanitizeMarkdownForImport(value)}
      onChange={(markdown, initialNormalize) => {
        if (!initialNormalize) {
          onChange(markdown);
        }
      }}
      placeholder={placeholder}
      suppressHtmlProcessing
      translation={editorTranslation}
      iconComponentFor={janosikIconFor}
      plugins={descriptionEditorPlugins}
    />
  );
}
