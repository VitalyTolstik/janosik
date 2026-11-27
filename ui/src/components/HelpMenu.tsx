import { useState } from "react";
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
import { useShortcutsHotkey } from "@/hooks/use-shortcuts-hotkey";
import { useI18n } from "@/i18n";
import { docsUrl } from "@/utils/docs-url";

/** Shortcut + documentation rows, shared by HelpMenu and BoardMenu. */
export function HelpMenuItems({ onShortcuts }: { onShortcuts: () => void }) {
  const { t, lang } = useI18n();
  return (
    <>
      <DropdownMenuItem
        className="max-lg:h-11"
        data-testid="help-shortcuts"
        onSelect={onShortcuts}
      >
        <Keyboard className="h-4 w-4" />
        <span className="flex-1">{t("shortcuts.title")}</span>
        <kbd className="rounded border border-border bg-muted px-1.5 font-mono text-ui-micro text-muted-foreground">
          ?
        </kbd>
      </DropdownMenuItem>
      <DropdownMenuItem className="max-lg:h-11" asChild>
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
    </>
  );
}

/**
 * The header's Help menu (TASK-132): one "?" entry point that opens the
 * keyboard-shortcut sheet and links to the documentation, the Linear/Notion
 * pattern. The `?` listener lives here on non-board routes; the Board menu
 * owns it on a board.
 */
export function HelpMenu({
  filter,
  kanban,
  canEdit,
  selectable,
}: {
  filter?: boolean;
  kanban?: boolean;
  canEdit?: boolean;
  selectable?: boolean;
}) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  useShortcutsHotkey(() => setShortcutsOpen(true));

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
          <HelpMenuItems onShortcuts={() => setShortcutsOpen(true)} />
        </DropdownMenuContent>
      </DropdownMenu>

      <ShortcutsDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
        filter={filter}
        kanban={kanban}
        canEdit={canEdit}
        selectable={selectable}
      />
    </>
  );
}
