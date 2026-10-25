import { AccountDialog } from "@/components/account/AccountDialog";
import { BoardMembersDialog } from "@/components/board/BoardMembersDialog";
import { ShareDialog } from "@/components/board/ShareDialog";
import { BoardSwitcher } from "@/components/board/BoardSwitcher";
import { BoardTitle } from "@/components/board/BoardTitle";
import { DataMenu } from "@/components/DataMenu";
import { GlobalSearch } from "@/components/GlobalSearch";
import { NotificationsBell } from "@/components/NotificationsBell";
import { ShortcutsDialog } from "@/components/ShortcutsDialog";
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
          <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-secondary text-primary-foreground shadow-sm">
            <svg
              className="janosik-feather"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <defs>
                <linearGradient
                  id="janosik-feather-grad"
                  x1="0"
                  y1="1"
                  x2="1"
                  y2="0"
                >
                  <stop
                    offset="0"
                    stopColor="currentColor"
                    stopOpacity="0.95"
                  />
                  <stop
                    offset="1"
                    stopColor="currentColor"
                    stopOpacity="0.72"
                  />
                </linearGradient>
              </defs>
              <path
                d="M14.086 18.412A2 2 0 0112.67 19H5v-7.672a2 2 0 01.586-1.414L11.75 3.75a6 6 0 118.49 8.49z"
                fill="url(#janosik-feather-grad)"
              />
              <path
                d="M16 8 2 22"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
              <path
                d="M17.488 15H9"
                stroke="currentColor"
                strokeWidth="1.1"
                strokeLinecap="round"
                opacity="0.6"
              />
            </svg>
            <svg
              className="janosik-sparkle pointer-events-none absolute -right-0.5 -top-0.5 h-3 w-3"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden
            >
              <path d="M12 0c.9 5.2 3.6 7.8 12 12-8.4 4.2-11.1 6.8-12 12-.9-5.2-3.6-7.8-12-12 8.4-4.2 11.1-6.8 12-12z" />
            </svg>
          </div>
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
        <ShortcutsDialog />

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
