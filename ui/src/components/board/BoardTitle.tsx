import { useRef, useState } from "react";
import { Pencil } from "lucide-react";

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
  const { id, title, archived } = useBoardIdentity();
  const { renameBoard, roleOf } = useBoardActions();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const startEdit = () => {
    setDraft(title);
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.select());
  };

  const save = (focusAfter: boolean) => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && id && trimmed !== title) {
      renameBoard(trimmed);
    }
    if (focusAfter) {
      requestAnimationFrame(() => headingRef.current?.focus());
    }
  };

  const cancel = () => {
    setEditing(false);
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  if (!id) return null;

  // VIEWER renames nothing — the header shows a plain heading (TASK-35).
  // An archived board is read-only until it is restored, so the deep-link
  // view cannot rewrite its name either.
  if (archived || roleOf(id) === "VIEWER") {
    return (
      <h1
        data-testid="board-title"
        tabIndex={-1}
        title={title}
        className="max-w-[30vw] truncate px-1.5 py-0.5 text-base font-semibold tracking-tight text-foreground sm:max-w-[320px] sm:min-w-0 sm:text-xl min-[1000px]:min-w-[10rem]"
      >
        {title}
      </h1>
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
        onBlur={() => save(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save(true);
          else if (e.key === "Escape") cancel();
        }}
        aria-label={t("board.editTitleAria")}
        className="h-8 w-36 max-w-[30vw] rounded-md border border-primary/40 bg-background/80 px-2 text-base font-semibold tracking-tight outline-none ring-2 ring-primary/20 backdrop-blur-sm sm:w-64 sm:text-lg"
      />
      <LimitCounter
        length={draft.length}
        limit={LIMITS.boardTitle}
        position="below"
        testId="board-title-limit"
      />
    </span>
  ) : (
    <div className="flex min-w-0 items-center gap-0.5">
      <h1
        ref={headingRef}
        data-testid="board-title"
        onClick={startEdit}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            startEdit();
          }
        }}
        title={`${title} — ${t("board.editTitleHint")}`}
        className="max-w-[30vw] cursor-text truncate rounded-md px-1.5 py-0.5 text-lg font-semibold tracking-tight text-foreground outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-primary/40 sm:max-w-[320px] sm:min-w-0 sm:text-xl min-[1000px]:min-w-[10rem]"
      >
        {title}
      </h1>
      <button
        type="button"
        onClick={startEdit}
        data-testid="board-rename"
        aria-label={t("board.rename")}
        title={t("board.editTitleHint")}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}
