import { useState } from "react";
import type { BoardRole, PresenceUser } from "@janosik/shared";

import { isApiEnabled } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { useOpenProfile } from "@/components/board/UserProfileDialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useI18n, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { useBoard } from "@/store/BoardContext";
import { useBoardMember, useBoardPresence } from "@/store/board-live";
import { userLabel } from "@/utils/avatar";

/** Avatars shown before the stack collapses into "+N". */
const MAX_VISIBLE = 5;

const ROLE_KEYS: Record<BoardRole, MessageKey> = {
  ADMIN: "board.members.role.admin",
  MEMBER: "board.members.role.member",
  VIEWER: "board.members.role.viewer",
};

/**
 * "On this board now" — the presence stack in the header (TASK-36).
 *
 * Overlapping avatars with a ring each so the circles stay separable, a
 * green pulse that says the roster is live, and a "+N" that opens the full
 * list with roles — the overflow is a doorway, not a dead end. New arrivals
 * scale in; someone leaving simply drops out. A solo user sees nothing: an
 * empty presence bar would be noise, not information.
 */
export function PresenceStack() {
  const { t, tp } = useI18n();
  const { board } = useBoard();
  const { user } = useAuth();
  const users = useBoardPresence(board?.id);
  const openProfile = useOpenProfile();
  const [open, setOpen] = useState(false);

  // Members are a server-only concept; solo boards stay quiet.
  if (!isApiEnabled() || !board || users.length < 2) return null;

  const visible = users.slice(0, MAX_VISIBLE);
  const overflow = users.length - visible.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="presence-stack"
          aria-label={tp("presence.people", users.length)}
          className="group flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-border/60 bg-card/60 py-0 pl-2 pr-2.5 transition-colors hover:border-primary/40 hover:bg-card"
        >
          <span className="flex items-center">
            {visible.map((person, index) => (
              <span
                key={person.id}
                data-testid="presence-avatar"
                className={cn("janosik-presence-in", index > 0 && "-ml-2")}
              >
                <UserAvatar
                  userId={person.id}
                  displayName={person.displayName}
                  email=""
                  color={person.avatarColor}
                  size="sm"
                  className="ring-2 ring-background"
                />
              </span>
            ))}
            {overflow > 0 ? (
              <span
                data-testid="presence-overflow"
                className="-ml-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold tabular-nums text-muted-foreground ring-2 ring-background"
              >
                +{overflow}
              </span>
            ) : null}
          </span>
          <span
            aria-hidden="true"
            data-testid="presence-live-dot"
            className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-success motion-reduce:animate-none"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 overflow-hidden rounded-xl border bg-popover/95 p-0 shadow-xl backdrop-blur-md"
      >
        <div className="border-b border-border/60 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("presence.title")}
        </div>
        <ul className="max-h-64 overflow-y-auto p-1.5">
          {users.map((person) => (
            <PresenceRow
              key={person.id}
              boardId={board.id}
              person={person}
              isMe={person.id === user?.id}
              onOpen={(userId) => {
                // The profile takes over the screen: the row list closes
                // first so the two overlays never fight for focus.
                setOpen(false);
                openProfile(userId);
              }}
            />
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function PresenceRow({
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
    <li>
      <button
        type="button"
        data-testid="presence-row"
        aria-label={t("profile.open", { name })}
        onClick={() => onOpen(person.id)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover"
      >
        <UserAvatar
          userId={person.id}
          displayName={person.displayName}
          email={member?.email ?? ""}
          color={person.avatarColor ?? member?.avatarColor}
          size="sm"
        />
        <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">
          {name}
        </span>
        {isMe ? (
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("presence.you")}
          </span>
        ) : member ? (
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/70">
            {t(ROLE_KEYS[member.role])}
          </span>
        ) : null}
      </button>
    </li>
  );
}
