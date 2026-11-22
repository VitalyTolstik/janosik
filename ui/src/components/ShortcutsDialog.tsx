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
      <span className="text-sm text-foreground/90">{action}</span>
      <span className="flex shrink-0 items-center gap-1">
        {keys.map((key) => (
          <kbd
            key={key}
            className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-border bg-muted px-1.5 font-mono text-xs font-medium text-foreground"
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filter?: boolean;
  kanban?: boolean;
  canEdit?: boolean;
  /** Board or table view with bulk selection enabled. */
  selectable?: boolean;
}) {
  const { t } = useI18n();

  // Re-computed per render — cheap, and `open` toggles remount the table.
  const mod = MOD;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md"
        // The sheet has no input to focus — without this, Radix focuses
        // the close X and paints its focus ring.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogTitle className="text-base font-semibold">
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
