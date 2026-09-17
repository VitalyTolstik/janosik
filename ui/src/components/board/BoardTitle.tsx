import { useRef, useState } from "react";

import { useI18n } from "@/i18n";
import { useBoardActions, useBoardIdentity } from "@/store/BoardContext";
import { LIMITS } from "@janosik/shared";
import { LimitCounter } from "@/components/ui/limit-counter";

/**
 * Inline-editable board title — the single source of truth for the name
 * (Trello's pattern: click the title, type, Enter/blur saves, Esc cancels).
 * Lives in the header next to the switcher; the content area shows no title.
 */
export function BoardTitle() {
  const { t } = useI18n();
  // Narrow subscriptions (TASK-21.4.1): the name is all this needs, so a
  // card edit somewhere on the board leaves the header title alone.
  const { id, title } = useBoardIdentity();
  const { renameBoard, roleOf } = useBoardActions();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setDraft(title);
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.select());
  };

  const save = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && id && trimmed !== title) {
      renameBoard(trimmed);
    }
  };

  if (!id) return null;

  // VIEWER renames nothing — the header shows a plain heading (TASK-35).
  if (roleOf(id) === "VIEWER") {
    return (
      <h2 className="max-w-[40vw] truncate px-1.5 py-0.5 text-lg font-semibold tracking-tight text-foreground sm:max-w-[320px] sm:text-xl">
        {title}
      </h2>
    );
  }

  return editing ? (
    <span className="relative inline-block">
      <input
        name="board-title-edit"
        ref={inputRef}
        value={draft}
        maxLength={LIMITS.boardTitle}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          else if (e.key === "Escape") setEditing(false);
        }}
        aria-label={t("board.editTitleAria")}
        className="h-8 w-48 rounded-md border border-primary/40 bg-background/80 px-2 text-lg font-semibold tracking-tight outline-none ring-2 ring-primary/20 backdrop-blur-sm sm:w-64"
      />
      <LimitCounter
        length={draft.length}
        limit={LIMITS.boardTitle}
        position="below"
        testId="board-title-limit"
      />
    </span>
  ) : (
    <h2
      onClick={startEdit}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          startEdit();
        }
      }}
      title={t("board.editTitleHint")}
      className="max-w-[40vw] cursor-text truncate rounded-md px-1.5 py-0.5 text-lg font-semibold tracking-tight text-foreground outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-primary/40 sm:max-w-[320px] sm:text-xl"
    >
      {title}
    </h2>
  );
}
