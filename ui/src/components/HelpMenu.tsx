import { useEffect, useState } from "react";
import { BookOpen, Keyboard } from "lucide-react";

import { ShortcutsDialog } from "@/components/ShortcutsDialog";
import { LazyAnimatedIcon } from "@/components/ui/lazy-animated-icon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";
import { docsUrl } from "@/utils/docs-url";
import { isOverlayOpen } from "@/utils/overlay";

import { isEditableTarget, isShortcutHelpKey } from "@/utils/keyboard";

/**
 * The header's Help menu (TASK-132): one "?" entry point that opens the
 * keyboard-shortcut sheet and links to the documentation, the Linear/Notion
 * pattern. "?" also opens the cheat sheet directly (Jira/Notion/GitHub
 * convention), which is why the listener lives here rather than in the sheet.
 */
export function HelpMenu({
  filter,
  kanban,
  canEdit,
}: {
  filter?: boolean;
  kanban?: boolean;
  canEdit?: boolean;
}) {
  const { t, lang } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        isEditableTarget(event.target) ||
        isOverlayOpen()
      )
        return;
      if (isShortcutHelpKey(event)) {
        event.preventDefault();
        setShortcutsOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                data-testid="help-trigger"
                aria-label={t("help.aria")}
                className="md:h-8 md:w-8 md:min-w-8"
              >
                <LazyAnimatedIcon name="keyboard" size={16} />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>
            {t("help.tooltip", { shortcut: "?" })}
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem
            data-testid="help-shortcuts"
            onSelect={() => setShortcutsOpen(true)}
          >
            <Keyboard className="h-4 w-4" />
            <span className="flex-1">{t("shortcuts.title")}</span>
            <kbd className="rounded border border-border bg-muted px-1.5 font-mono text-xs text-muted-foreground">
              ?
            </kbd>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a
              data-testid="help-docs"
              href={docsUrl(lang)}
              target="_blank"
              rel="noreferrer"
            >
              <BookOpen className="h-4 w-4" />
              {t("help.documentation")}
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ShortcutsDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
        filter={filter}
        kanban={kanban}
        canEdit={canEdit}
      />
    </>
  );
}
