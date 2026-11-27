import { useEffect, useState } from "react";
import { Share2, UserPlus } from "lucide-react";
import type { BoardRole } from "@janosik/shared";

import { useAuth } from "@/auth/AuthContext";
import { useBoardPeople } from "@/hooks/use-board-people";
import { BreakableText } from "@/components/ui/breakable-text";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useI18n, type MessageKey } from "@/i18n";
import { useBoardMembersList, useBoardPresence } from "@/store/board-live";
import { userLabel } from "@/utils/avatar";

const ROLE_KEYS: Record<BoardRole, MessageKey> = {
  ADMIN: "board.members.role.admin",
  MEMBER: "board.members.role.member",
  VIEWER: "board.members.role.viewer",
};

export function PeoplePanel({ boardId }: { boardId: string }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const people = useBoardPeople();
  const members = useBoardMembersList(boardId);
  const presence = useBoardPresence(boardId);
  const [now, setNow] = useState(Date.now);
  const activeMembers = members.filter(
    ({ expiresAt }) => (expiresAt ?? Infinity) > now,
  );
  const nextExpiry = activeMembers.reduce(
    (earliest, { expiresAt }) => Math.min(earliest, expiresAt ?? Infinity),
    Infinity,
  );
  useEffect(() => {
    if (!Number.isFinite(nextExpiry)) return;
    // eslint-disable-next-line react-hooks/purity -- schedule against the clock after commit, even if the roster arrived later
    const delay = Math.min(nextExpiry - Date.now(), 2_147_483_647);
    const timer = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [nextExpiry, now]);

  if (!people) return null;
  const { archived, showMembers, showShare, openDialog } = people;
  const online = new Set(archived ? [] : presence.map((person) => person.id));
  const onlineMembers = activeMembers.filter(({ userId }) =>
    online.has(userId),
  );
  const offlineMembers = activeMembers.filter(
    ({ userId }) => !online.has(userId),
  );

  return (
    <div className="space-y-4 p-4">
      {showMembers || showShare ? (
        <div className="flex flex-wrap gap-2">
          {showMembers ? (
            <Button
              variant="outline"
              className="inspector-action"
              onClick={(event) => openDialog("members", event.currentTarget)}
            >
              <UserPlus aria-hidden />
              {t("board.members.button")}
            </Button>
          ) : null}
          {showShare ? (
            <Button
              variant="outline"
              className="inspector-action"
              onClick={(event) => openDialog("share", event.currentTarget)}
            >
              <Share2 aria-hidden />
              {t("share.button")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {archived ? (
        <p className="text-ui-body text-muted-foreground">
          {t("inspector.archived")}
        </p>
      ) : null}

      {[
        ...(archived
          ? []
          : [{ label: t("presence.title"), members: onlineMembers }]),
        {
          label: t(
            archived ? "board.members.button" : "inspector.otherMembers",
          ),
          members: offlineMembers,
        },
      ].map(({ label, members: group }) => (
        <section key={label} aria-label={label}>
          <h3 className="mb-2 text-ui-label font-semibold text-muted-foreground">
            {label}
          </h3>
          {group.length === 0 ? (
            <p className="text-ui-body text-muted-foreground">
              {t(
                label === t("presence.title")
                  ? "inspector.noPresence"
                  : "inspector.noMembers",
              )}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {group.map((member) => (
                <li
                  key={member.userId}
                  className="flex min-w-0 items-center gap-2 py-2 text-ui-body"
                >
                  <UserAvatar
                    userId={member.userId}
                    displayName={member.displayName}
                    email={member.email}
                    color={member.avatarColor}
                    avatarPath={member.avatarPath}
                    size="sm"
                  />
                  <span
                    className="min-w-0 flex-1 break-words"
                    title={userLabel(member.displayName, member.email)}
                  >
                    <BreakableText
                      text={userLabel(member.displayName, member.email)}
                    />
                    {user?.id === member.userId ? (
                      <span className="ml-1 whitespace-nowrap text-ui-label text-muted-foreground">
                        ({t("board.members.you")})
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-ui-label text-muted-foreground">
                    {t(ROLE_KEYS[member.role])}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
