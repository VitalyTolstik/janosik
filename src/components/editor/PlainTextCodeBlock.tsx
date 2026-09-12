import { useEffect, useState } from "react";

import { useCodeBlockEditorContext } from "@mdxeditor/editor";

import { useI18n } from "@/i18n";

/**
 * Dependency-free code block editor for the card description (TASK-21).
 *
 * MDXEditor refuses to *import* any fenced code block unless a code block
 * editor descriptor matches it — without one the import dies mid-document
 * and the library permanently mutes onChange (silent data loss). The stock
 * CodeMirror editor costs ~430 KB in the bundle; for a kanban card a plain
 * monospace textarea is enough, so we register this catch-all descriptor
 * instead (`codeBlockPlugin({ codeBlockEditorDescriptors: [...] })` in
 * `plugins.tsx`).
 *
 * Edits go through `useCodeBlockEditorContext().setCode`, which updates the
 * Lexical node and dispatches `NESTED_EDITOR_UPDATED_COMMAND` — parent
 * undo/redo and the markdown export stay in the loop. `parentEditor
 * .isReadOnly()` disables typing in the read-only card preview.
 */
export function PlainTextCodeBlockEditor({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  const { t } = useI18n();
  const { setCode, parentEditor } = useCodeBlockEditorContext();
  const readOnly = !parentEditor.isEditable();

  // Local draft keeps fast typing smooth (props update only after the
  // Lexical commit); resync on external changes (undo/redo, remount).
  const [draft, setDraft] = useState(code);
  useEffect(() => {
    setDraft(code);
  }, [code]);

  return (
    <div className="janosik-md-codeblock">
      <textarea
        name="code-block"
        aria-label={
          language
            ? `${t("editor.codeBlock")} (${language})`
            : t("editor.codeBlock")
        }
        className="janosik-md-codeblock-textarea"
        readOnly={readOnly}
        rows={Math.max(2, code.split("\n").length)}
        spellCheck={false}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setCode(e.target.value);
        }}
      />
      {language ? (
        <span aria-hidden className="janosik-md-codeblock-lang">
          {language}
        </span>
      ) : null}
    </div>
  );
}
