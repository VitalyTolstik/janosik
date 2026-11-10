import { AccountDialog } from "@/components/account/AccountDialog";
import { BrandMark } from "@/components/BrandMark";
import { BoardMembersDialog } from "@/components/board/BoardMembersDialog";
import { BoardSettingsDialog } from "@/components/board/BoardSettingsDialog";
import { ShareDialog } from "@/components/board/ShareDialog";
import { BoardSwitcher } from "@/components/board/BoardSwitcher";
import { BoardTitle } from "@/components/board/BoardTitle";
import { DataMenu } from "@/components/DataMenu";
import { GlobalSearch } from "@/components/GlobalSearch";
import { HelpMenu } from "@/components/HelpMenu";
import { NotificationsBell } from "@/components/NotificationsBell";
import { LazyAnimatedIcon } from "@/components/ui/lazy-animated-icon";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";
import { PresenceStack } from "@/components/board/PresenceStack";
import {
  useBoardAccess,
  useBoardActions,
  useBoardHistory,
} from "@/store/BoardContext";

/** Header: brand, board switcher, search, undo/redo, data and the account. */
export function Header() {
  const { t } = useI18n();
  // Narrow subscriptions on purpose (TASK-21.4): the actions never change
  // and the flags flip rarely, so typing in a card leaves the header alone.
  const { undo, redo } = useBoardActions();
  const { canUndo, canRedo } = useBoardHistory();
  const { role } = useBoardAccess();
  // A VIEWER has no mutating affordances, undo included: a stale local stack
  // after a live demotion would only offer commands the server refuses.
  const readOnly = role === "VIEWER";
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 flex min-h-14 shrink-0 flex-col gap-1 border-b bg-background/80 bg-gradient-to-br from-primary/15 via-secondary/10 to-transparent px-3 py-1.5 backdrop-blur-md sm:h-14 sm:flex-row sm:flex-nowrap sm:items-center sm:justify-between sm:gap-0 sm:px-6 sm:py-0">
      <div className="group flex w-full min-w-0 items-center gap-1 sm:w-auto sm:flex-1 sm:gap-3">
        <BrandMark />
        {/* Board title (inline-editable) + its switcher — the Trello model:
            one name on screen, switch and rename are separate triggers. */}
        <BoardTitle />
        <BoardSwitcher />
        <NotificationsBell />
        <BoardMembersDialog />
        <ShareDialog />
        {role === "ADMIN" ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("board.settings.button")}
                data-testid="board-settings-trigger"
                onClick={() => setSettingsOpen(true)}
              >
                <LazyAnimatedIcon name="settings" size={20} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("board.settings.button")}</TooltipContent>
          </Tooltip>
        ) : null}
        {/* The presence stack needs more width than a phone header can
            give; the roster stays reachable from the members dialog. */}
        <div className="hidden sm:block">
          <PresenceStack />
        </div>
      </div>

      <div className="ml-auto flex w-full shrink-0 items-center justify-end gap-0.5 sm:w-auto sm:justify-start">
        <GlobalSearch />
        <HelpMenu />

        {!readOnly ? (
          <>
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
          </>
        ) : null}

        <DataMenu />

        <AccountDialog />
      </div>

      {settingsOpen ? (
        <BoardSettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
        />
      ) : null}
    </header>
  );
}
