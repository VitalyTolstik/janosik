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

/** Guard: "?" must not fire while the user is typing. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

/**
 * The header's Help menu (TASK-132): one "?" entry point that opens the
 * keyboard-shortcut sheet and links to the documentation, the Linear/Notion
 * pattern. "?" also opens the cheat sheet directly (Jira/Notion/GitHub
 * convention), which is why the listener lives here rather than in the sheet.
 */
export function HelpMenu() {
  const { t, lang } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      // "?" is Shift+/ on most layouts, but some layouts report the key
      // differently — accept both the character and Shift+Slash.
      const isQuestionMark =
        event.key === "?" || (event.code === "Slash" && event.shiftKey);
      if (isQuestionMark) {
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
              >
                <LazyAnimatedIcon name="keyboard" size={20} />
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

      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </>
  );
}
