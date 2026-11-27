import { useState } from "react";
import { Share2, UserPlus, Users } from "lucide-react";
import type { BoardRole, PresenceUser } from "@janosik/shared";

import { isApiEnabled } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { useBoardPeople } from "@/hooks/use-board-people";
import { useOpenProfile } from "@/components/board/UserProfileDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useI18n, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { useBoard } from "@/store/BoardContext";
import { useBoardMember, useBoardPresence } from "@/store/board-live";
import { userLabel } from "@/utils/avatar";

const MAX_VISIBLE = 3;

const ROLE_KEYS: Record<BoardRole, MessageKey> = {
  ADMIN: "board.members.role.admin",
  MEMBER: "board.members.role.member",
  VIEWER: "board.members.role.viewer",
};

/**
 * One header entry for everyone on the board (H1): members, sharing and
 * presence. Replaces the old Members + Share + Presence trio, and makes
 * presence reachable below 1200 px for the first time. The dialogs, role
 * checks and archived-board rules are the existing ones — this is a new
 * doorway, not a new permission model.
 */
export function PeopleMenu() {
  const { t, tp } = useI18n();
  const { board } = useBoard();
  const { user } = useAuth();
  const openProfile = useOpenProfile();
  const users = useBoardPresence(board?.id);
  const [open, setOpen] = useState(false);
  const people = useBoardPeople();

  // Members, sharing and presence are server-only concepts; local mode had
  // no members/share/presence triggers before H1 either.
  if (!isApiEnabled() || !board || !people) return null;
  const { menuRef: triggerRef, showMembers, showShare, openDialog } = people;

  const visible = users.slice(0, MAX_VISIBLE);
  const overflow = users.length - visible.length;
  const label =
    users.length > 1
      ? `${t("people.button")} — ${tp("presence.people", users.length)}`
      : t("people.button");

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              ref={triggerRef}
              variant="ghost"
              size="icon"
              aria-label={label}
              data-testid="people-trigger"
              className="group relative shrink-0 gap-1 rounded-full border border-border/60 bg-card/60 px-1.5 hover:border-primary/40 hover:bg-card max-lg:h-11 max-lg:w-11 max-lg:min-w-11 lg:h-8 lg:w-auto lg:min-w-8 lg:rounded-full lg:px-2"
            >
              <span className="hidden items-center lg:flex">
                {visible.length === 0 ? (
                  <Users className="h-4 w-4 text-muted-foreground" />
                ) : (
                  visible.map((person, index) => (
                    <span
                      key={person.id}
                      data-testid="people-avatar"
                      className={cn(
                        "janosik-presence-in",
                        index > 0 && "-ml-2",
                      )}
                    >
                      <UserAvatar
                        userId={person.id}
                        displayName={person.displayName}
                        email=""
                        color={person.avatarColor}
                        avatarPath={person.avatarPath}
                        size="sm"
                        className="ring-2 ring-background"
                      />
                    </span>
                  ))
                )}
                {overflow > 0 ? (
                  <span
                    data-testid="people-overflow"
                    className="-ml-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-ui-micro font-semibold tabular-nums text-muted-foreground ring-2 ring-background"
                  >
                    +{overflow}
                  </span>
                ) : null}
              </span>
              <Users
                className="h-[18px] w-[18px] text-muted-foreground lg:hidden"
                aria-hidden
              />
              <span
                aria-hidden="true"
                data-testid="people-live-dot"
                className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-background bg-success"
              />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("people.button")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-ui-label uppercase tracking-wide text-muted-foreground">
          {t("people.title")}
        </DropdownMenuLabel>
        {showMembers ? (
          <DropdownMenuItem
            className="max-lg:h-11"
            data-testid="people-members"
            onSelect={() => openDialog("members")}
          >
            <UserPlus className="h-4 w-4" />
            {t("board.members.button")}
          </DropdownMenuItem>
        ) : null}
        {showShare ? (
          <DropdownMenuItem
            className="max-lg:h-11"
            data-testid="people-share"
            onSelect={() => openDialog("share")}
          >
            <Share2 className="h-4 w-4" />
            {t("share.button")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-1.5 text-ui-micro font-semibold uppercase tracking-wide text-muted-foreground">
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 rounded-full bg-success"
          />
          {t("presence.title")}
        </DropdownMenuLabel>
        {users.length === 0 ? (
          <p className="px-2 pb-1.5 text-ui-label text-muted-foreground">
            {t("people.empty")}
          </p>
        ) : (
          users.map((person) => (
            <PeoplePresenceRow
              key={person.id}
              boardId={board.id}
              person={person}
              isMe={person.id === user?.id}
              onOpen={(userId) => {
                setOpen(false);
                // Radix returns menu focus to the trigger as the menu
                // unmounts; run after that pass so the profile dialog
                // records the trigger as its return target.
                window.setTimeout(() => {
                  triggerRef.current?.focus();
                  openProfile(userId);
                }, 0);
              }}
            />
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PeoplePresenceRow({
  boardId,
  person,
  isMe,
  onOpen,
}: {
  boardId: string;
  person: PresenceUser;
  isMe: boolean;
  onOpen: (userId: string) => void;
}) {
  const { t } = useI18n();
  const member = useBoardMember(boardId, person.id);
  const name = userLabel(person.displayName, member?.email ?? "");

  return (
    <DropdownMenuItem
      data-testid="people-presence-row"
      className="max-lg:h-11"
      onSelect={() => onOpen(person.id)}
    >
      <UserAvatar
        userId={person.id}
        displayName={person.displayName}
        email={member?.email ?? ""}
        color={person.avatarColor ?? member?.avatarColor}
        avatarPath={person.avatarPath ?? member?.avatarPath}
        size="sm"
      />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {isMe ? (
        <span className="shrink-0 text-ui-micro font-medium uppercase tracking-wide text-muted-foreground">
          {t("presence.you")}
        </span>
      ) : member ? (
        <span className="shrink-0 text-ui-micro uppercase tracking-wide text-muted-foreground/70">
          {t(ROLE_KEYS[member.role])}
        </span>
      ) : null}
    </DropdownMenuItem>
  );
}
