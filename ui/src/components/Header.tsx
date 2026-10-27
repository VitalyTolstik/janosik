import { AccountDialog } from "@/components/account/AccountDialog";
import { BrandMark } from "@/components/BrandMark";
import { BoardMembersDialog } from "@/components/board/BoardMembersDialog";
import { ShareDialog } from "@/components/board/ShareDialog";
import { BoardSwitcher } from "@/components/board/BoardSwitcher";
import { BoardTitle } from "@/components/board/BoardTitle";
import { DataMenu } from "@/components/DataMenu";
import { GlobalSearch } from "@/components/GlobalSearch";
import { HelpMenu } from "@/components/HelpMenu";
import { NotificationsBell } from "@/components/NotificationsBell";
import { LazyAnimatedIcon } from "@/components/ui/lazy-animated-icon";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";
import { PresenceStack } from "@/components/board/PresenceStack";
import { useBoardActions, useBoardHistory } from "@/store/BoardContext";

/** Header: brand, board switcher, search, undo/redo, data and the account. */
export function Header() {
  const { t } = useI18n();
  // Narrow subscriptions on purpose (TASK-21.4): the actions never change
  // and the flags flip rarely, so typing in a card leaves the header alone.
  const { undo, redo } = useBoardActions();
  const { canUndo, canRedo } = useBoardHistory();

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between border-b bg-background/80 bg-gradient-to-br from-primary/15 via-secondary/10 to-transparent px-4 backdrop-blur-md sm:px-6">
      <div className="flex items-center gap-2 sm:gap-3">
        {/* `group` re-enables the CSS hover animations (feather sway +
            sparkle twinkle) that key off `.group:hover` in index.css. */}
        <div className="group flex items-center gap-1.5">
          <BrandMark />
          {/* Board title (inline-editable) + its switcher — the Trello model:
              one name on screen, switch and rename are separate triggers. */}
          <BoardTitle />
          <BoardSwitcher />
          <NotificationsBell />
          <BoardMembersDialog />
          <ShareDialog />
          <PresenceStack />
        </div>
      </div>

      <div className="flex items-center gap-0.5">
        <GlobalSearch />
        <HelpMenu />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("undo.aria")}
              disabled={!canUndo}
              onClick={undo}
            >
              <LazyAnimatedIcon name="arrow-left" size={20} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("undo.tooltip")}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("redo.aria")}
              disabled={!canRedo}
              onClick={redo}
            >
              <LazyAnimatedIcon name="arrow-right" size={20} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("redo.tooltip")}</TooltipContent>
        </Tooltip>

        <DataMenu />

        <AccountDialog />
      </div>
    </header>
  );
}
