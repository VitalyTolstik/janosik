import { LazyAnimatedIcon } from "@/components/ui/lazy-animated-icon";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";
import { isMacPlatform } from "@/utils/platform";

const MOD = isMacPlatform() ? "⌘" : "Ctrl+";

/** Guard: single-letter shortcuts must not fire while typing. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

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
 * Keyboard-shortcut cheat sheet ("?" opens it — the Jira/Notion/GitHub
 * convention, plus a header button for discoverability). The bindings are
 * defined once here; the DndBoard/GlobalSearch/BoardContext handlers
 * implement the behaviour.
 */
export function ShortcutsDialog() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      // "?" is Shift+/ on most layouts, but some layouts report the key
      // differently — accept both the character and Shift+Slash.
      const isQuestionMark =
        event.key === "?" || (event.code === "Slash" && event.shiftKey);
      if (isQuestionMark) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Re-computed per render — cheap, and `open` toggles remount the table.
  const mod = MOD;

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("shortcuts.aria")}
            onClick={() => setOpen(true)}
          >
            <LazyAnimatedIcon name="keyboard" size={20} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {t("shortcuts.tooltip", { shortcut: "?" })}
        </TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
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
            <ShortcutRow action={t("shortcuts.undo")} keys={[`${mod}Z`]} />
            <ShortcutRow
              action={t("shortcuts.redo")}
              keys={[`${mod}⇧Z`, `${mod}Y`]}
            />
            <ShortcutRow action={t("shortcuts.newCard")} keys={["N"]} />
            <ShortcutRow action={t("shortcuts.newColumn")} keys={["C"]} />
            <ShortcutRow action={t("shortcuts.moveDown")} keys={["J"]} />
            <ShortcutRow action={t("shortcuts.moveUp")} keys={["K"]} />
            <ShortcutRow action={t("shortcuts.openCard")} keys={["E", "↵"]} />
            <ShortcutRow action={t("shortcuts.help")} keys={["?"]} />
            <ShortcutRow action={t("shortcuts.close")} keys={["Esc"]} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
