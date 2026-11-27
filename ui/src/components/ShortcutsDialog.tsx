import { useRef, type RefObject } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import { isMacPlatform } from "@/utils/platform";

const MOD = isMacPlatform() ? "⌘" : "Ctrl+";

/**
 * One row of the shortcuts table: action + key badge(s).
 */
function ShortcutRow({ action, keys }: { action: string; keys: string[] }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span className="text-ui-body text-foreground/90">{action}</span>
      <span className="flex shrink-0 items-center gap-1">
        {keys.map((key) => (
          <kbd
            key={key}
            className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-border bg-muted px-1.5 font-mono text-ui-micro font-medium text-foreground"
          >
            {key}
          </kbd>
        ))}
      </span>
    </div>
  );
}

/**
 * The keyboard-shortcut cheat sheet (Jira/Notion/GitHub convention: "?" opens
 * it). Controlled: the Help menu owns the trigger and the "?" listener, this
 * renders the sheet alone. The bindings are defined once here; the
 * DndBoard/GlobalSearch/BoardContext handlers implement the behaviour.
 */
export function ShortcutsDialog({
  open,
  onOpenChange,
  filter,
  kanban,
  canEdit,
  selectable,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filter?: boolean;
  kanban?: boolean;
  canEdit?: boolean;
  /** Board or table view with bulk selection enabled. */
  selectable?: boolean;
  /** Menu trigger, so closing returns focus there, not BODY. */
  returnFocusRef?: RefObject<HTMLElement>;
}) {
  const { t } = useI18n();
  const titleRef = useRef<HTMLHeadingElement>(null);

  // Re-computed per render — cheap, and `open` toggles remount the table.
  const mod = MOD;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md"
        // The sheet has no input; focus the title so Escape reaches the
        // dialog without putting Radix's ring on the close X.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          titleRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          const target = returnFocusRef?.current;
          if (!target) return;
          event.preventDefault();
          target.focus();
        }}
      >
        <DialogTitle
          ref={titleRef}
          tabIndex={-1}
          className="text-ui-heading font-semibold outline-none"
        >
          {t("shortcuts.title")}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {t("shortcuts.aria")}
        </DialogDescription>
        <div
          data-testid="shortcuts-table"
          className="divide-y divide-border/60"
        >
          <ShortcutRow action={t("shortcuts.search")} keys={[`${mod}K`]} />
          {filter ? (
            <ShortcutRow action={t("shortcuts.filter")} keys={["/"]} />
          ) : null}
          {canEdit ? (
            <>
              <ShortcutRow action={t("shortcuts.undo")} keys={[`${mod}Z`]} />
              <ShortcutRow
                action={t("shortcuts.redo")}
                keys={[`${mod}⇧Z`, `${mod}Y`]}
              />
            </>
          ) : null}
          {canEdit && selectable ? (
            <ShortcutRow action={t("shortcuts.selectAll")} keys={[`${mod}A`]} />
          ) : null}
          {kanban ? (
            <>
              {canEdit ? (
                <>
                  <ShortcutRow action={t("shortcuts.newCard")} keys={["N"]} />
                  <ShortcutRow action={t("shortcuts.newColumn")} keys={["C"]} />
                </>
              ) : null}
              <ShortcutRow action={t("shortcuts.moveDown")} keys={["J"]} />
              <ShortcutRow action={t("shortcuts.moveUp")} keys={["K"]} />
              <ShortcutRow action={t("shortcuts.openCard")} keys={["E", "↵"]} />
              {canEdit ? (
                <ShortcutRow action={t("shortcuts.selectCard")} keys={["X"]} />
              ) : null}
            </>
          ) : null}
          <ShortcutRow action={t("shortcuts.help")} keys={["?"]} />
          <ShortcutRow action={t("shortcuts.close")} keys={["Esc"]} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
