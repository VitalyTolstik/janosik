import { createContext, useContext, useState, type ReactNode } from "react";
import type { BoardRole } from "@janosik/shared";

import { useAuth } from "@/auth/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UserAvatar } from "@/components/ui/user-avatar";
import { formatDateOnly, useI18n, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { useBoardMember, useBoardPresence } from "@/store/board-live";
import { userLabel } from "@/utils/avatar";

const ROLE_KEYS = {
  ADMIN: "board.members.role.admin",
  MEMBER: "board.members.role.member",
  VIEWER: "board.members.role.viewer",
} satisfies Record<BoardRole, MessageKey>;

const OpenProfileContext = createContext<(userId: string) => void>(
  () => undefined,
);

/**
 * Open the read-only profile of one board member (TASK-36.1 addendum).
 *
 * Callers get the opener from context; one dialog instance serves every
 * trigger on the board. A dialog per row would mount hundreds of Radix roots
 * on a big roster or a 500-card table — and profiles are a single overlay by
 * nature. Components rendered outside a provider (isolated tests) get a
 * no-op opener, the same tolerance `useAuth`/`useBoardLive` have.
 */
export function useOpenProfile(): (userId: string) => void {
  return useContext(OpenProfileContext);
}

interface UserProfileProviderProps {
  /** The board the faces on screen belong to; `undefined` before hydration. */
  boardId: string | undefined;
  children: ReactNode;
}

export function UserProfileProvider({
  boardId,
  children,
}: UserProfileProviderProps) {
  const [userId, setUserId] = useState<string | null>(null);

  return (
    <OpenProfileContext.Provider value={setUserId}>
      {children}
      <UserProfileDialog
        boardId={boardId}
        userId={userId}
        onOpenChange={(open) => {
          if (!open) setUserId(null);
        }}
      />
    </OpenProfileContext.Provider>
  );
}

interface UserProfileDialogProps {
  boardId: string | undefined;
  /** Who to show; `null` closes the dialog. */
  userId: string | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * The profile card itself: face, name, email, live online status, board role
 * and — for a time-limited VIEWER — the access deadline. Everything comes
 * from the member directory with the presence roster as the fallback, so the
 * card still renders for a face seen before the directory loaded.
 */
export function UserProfileDialog({
  boardId,
  userId,
  onOpenChange,
}: UserProfileDialogProps) {
  return (
    <Dialog open={userId !== null} onOpenChange={onOpenChange}>
      <DialogContent data-testid="user-profile-dialog" className="sm:max-w-sm">
        {/* Keyed by member: the body remounts per person, so `now` — frozen
            at mount for the expiry badge — is fresh for every open. */}
        {userId === null ? null : (
          <UserProfileBody key={userId} boardId={boardId} userId={userId} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function UserProfileBody({
  boardId,
  userId,
}: {
  boardId: string | undefined;
  userId: string;
}) {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const member = useBoardMember(boardId, userId);
  const person = useBoardPresence(boardId).find((row) => row.id === userId);
  // Frozen at mount (react-hooks/purity): the deadline badge never calls
  // `Date.now()` during render, and the key above refreshes it per open.
  const [now] = useState(() => Date.now());

  const displayName = member?.displayName ?? person?.displayName ?? null;
  const email = member?.email ?? "";
  const color = member?.avatarColor ?? person?.avatarColor ?? null;
  const label = userLabel(displayName, email) || t("profile.title");
  const online = person !== undefined;
  const expired = member?.expiresAt != null && member.expiresAt <= now;
  const isSelf = userId === user?.id;

  return (
    <>
      <DialogHeader className="items-center space-y-3 text-center sm:items-center sm:text-center">
        <UserAvatar
          userId={userId ?? ""}
          displayName={displayName}
          email={email}
          color={color}
          size="lg"
          className="h-16 w-16 text-xl shadow-sm"
        />
        <div className="space-y-1">
          <DialogTitle
            data-testid="user-profile-name"
            className="flex items-center justify-center gap-2 text-base"
          >
            {label}
            {isSelf ? (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                {t("profile.you")}
              </span>
            ) : null}
          </DialogTitle>
          <DialogDescription
            data-testid="user-profile-email"
            className={cn(!email && "sr-only")}
          >
            {email || t("profile.title")}
          </DialogDescription>
        </div>
        <span
          data-testid="user-profile-status"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
            online
              ? "border-success/40 bg-success/10 text-success"
              : "border-border bg-muted text-muted-foreground",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              online ? "bg-success" : "bg-muted-foreground/50",
            )}
          />
          {online ? t("profile.online") : t("profile.offline")}
        </span>
      </DialogHeader>

      <dl
        data-testid="user-profile-facts"
        className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg border bg-muted/30 p-3 text-sm"
      >
        <dt className="text-muted-foreground">{t("profile.role")}</dt>
        <dd data-testid="user-profile-role" className="text-right font-medium">
          {member ? t(ROLE_KEYS[member.role]) : "—"}
        </dd>
        {member?.role === "VIEWER" ? (
          <>
            <dt className="text-muted-foreground">{t("profile.access")}</dt>
            <dd
              data-testid="user-profile-access"
              className={cn("text-right", expired && "text-danger")}
            >
              {member.expiresAt === null
                ? t("board.members.expires.never")
                : t("board.members.expires.until", {
                    date: formatDateOnly(member.expiresAt, lang),
                  })}
              {expired ? ` · ${t("board.members.expires.expired")}` : ""}
            </dd>
          </>
        ) : null}
      </dl>
    </>
  );
}
