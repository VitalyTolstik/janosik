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
 *
 * H1: the pencil is a decorative hint revealed on hover/focus inside the
 * title, not a permanent header button. Clicking it bubbles to the heading,
 * which is already the accessible rename control.
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
        className="max-w-full min-w-[7rem] flex-1 truncate px-1.5 py-0.5 text-base font-semibold tracking-tight text-foreground max-lg:flex max-lg:min-h-11 max-lg:items-center sm:max-w-[320px] sm:flex-none sm:min-w-0 sm:text-lg lg:text-xl min-[1000px]:min-w-[10rem]"
      >
        {title}
      </h1>
    );
  }

  return editing ? (
    <span className="relative inline-block min-w-0">
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
        className="h-8 w-[min(16rem,calc(100vw-8rem))] rounded-md border border-primary/40 bg-background/80 px-2 text-base font-semibold tracking-tight outline-none ring-2 ring-primary/20 backdrop-blur-sm sm:w-64 sm:text-lg"
      />
      <LimitCounter
        length={draft.length}
        limit={LIMITS.boardTitle}
        position="below"
        testId="board-title-limit"
      />
    </span>
  ) : (
    <div className="group/title flex min-w-0 flex-1 items-center gap-0.5 sm:flex-none">
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
        className="flex max-w-full min-w-[7rem] flex-1 cursor-text items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-base font-semibold tracking-tight text-foreground outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-primary/40 max-lg:min-h-11 sm:max-w-[320px] sm:flex-none sm:text-lg lg:min-h-0 lg:text-xl min-[1000px]:min-w-[10rem]"
      >
        <span className="truncate">{title}</span>
        <span
          data-testid="board-rename"
          aria-hidden="true"
          className="pointer-events-none inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground opacity-0 transition-opacity group-hover/title:opacity-80 group-focus-within/title:opacity-80"
        >
          <Pencil className="h-3.5 w-3.5" />
        </span>
      </h1>
    </div>
  );
}
