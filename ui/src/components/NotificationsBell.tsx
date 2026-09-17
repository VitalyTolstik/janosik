import { useCallback, useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import type { BoardInvitationDto, BoardRole } from "@janosik/shared";

import { api, ApiError, isApiEnabled } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { useToast } from "@/components/Toast";
import { Button } from "@/components/ui/button";
import { LazyAnimatedIcon } from "@/components/ui/lazy-animated-icon";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatDateOnly, useI18n, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { useBoardActions } from "@/store/BoardContext";

/**
 * Notifications bell (TASK-35 addendum): invitations are opt-in, so the
 * invitee needs a place to see and answer them. The bell carries a count
 * badge and turns accent-colored while something is pending; the panel
 * lists board, inviter, role and VIEWER expiry with Accept / Decline.
 * Data refreshes on mount, on window focus and after every answer —
 * SSE-based delivery is TASK-30/36 territory.
 */

const ROLE_KEYS = {
  ADMIN: "board.members.role.admin",
  MEMBER: "board.members.role.member",
  VIEWER: "board.members.role.viewer",
} satisfies Record<BoardRole, MessageKey>;

type Translate = ReturnType<typeof useI18n>["t"];

function invitationError(error: unknown, t: Translate): string {
  if (error instanceof ApiError) {
    if (error.offline) return t("notifications.errors.offline");
    if (error.status === 409) return t("notifications.errors.expired");
    if (error.status === 404) return t("notifications.errors.gone");
  }
  return t("notifications.errors.generic");
}

export function NotificationsBell() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [invitations, setInvitations] = useState<BoardInvitationDto[] | null>(
    null,
  );
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setInvitations(await api.listInvitations());
    } catch {
      // A failed poll must not wipe what was already shown.
    }
  }, []);

  useEffect(() => {
    if (!isApiEnabled() || user === null) return;
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load, user]);

  if (!isApiEnabled() || user === null) return null;

  const count = invitations?.length ?? 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("notifications.aria")}
          data-testid="notifications-bell"
          className={cn(
            "relative",
            count > 0
              ? "text-primary hover:text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <LazyAnimatedIcon name="bell" size={20} />
          {count > 0 ? (
            <span
              data-testid="notifications-badge"
              className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white"
            >
              {count}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 overflow-hidden rounded-xl border bg-popover/95 p-0 shadow-xl backdrop-blur-md"
      >
        <NotificationsPanel
          invitations={invitations}
          onClose={() => setOpen(false)}
          onReload={() => void load()}
        />
      </PopoverContent>
    </Popover>
  );
}

interface NotificationsPanelProps {
  invitations: BoardInvitationDto[] | null;
  onClose: () => void;
  onReload: () => void;
}

function NotificationsPanel({
  invitations,
  onClose,
  onReload,
}: NotificationsPanelProps) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { refreshBoards } = useBoardActions();
  const [pendingId, setPendingId] = useState<string | null>(null);
  // Frozen at mount (the panel remounts on every open) so the "expired"
  // check never calls an impure function during render.
  const [now] = useState(() => Date.now());

  const handleAccept = async (invitation: BoardInvitationDto) => {
    setPendingId(invitation.id);
    try {
      await api.acceptInvitation(invitation.id);
      toast.success(
        t("notifications.accepted", { title: invitation.boardTitle }),
      );
      onClose();
      // The board must appear in the switcher without a reload.
      await refreshBoards();
    } catch (error) {
      toast.error(invitationError(error, t));
      onReload();
    } finally {
      setPendingId(null);
    }
  };

  const handleDecline = async (invitation: BoardInvitationDto) => {
    setPendingId(invitation.id);
    try {
      await api.declineInvitation(invitation.id);
      toast.info(t("notifications.declined", { title: invitation.boardTitle }));
      onReload();
    } catch (error) {
      toast.error(invitationError(error, t));
      onReload();
    } finally {
      setPendingId(null);
    }
  };

  return (
    <>
      <div className="border-b border-border/60 px-3 py-2">
        <p className="text-sm font-semibold">
          {invitations === null
            ? t("notifications.titlePlain")
            : t("notifications.title", { count: invitations.length })}
        </p>
      </div>

      {invitations === null ? (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">
          {t("notifications.loading")}
        </p>
      ) : invitations.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">
          {t("notifications.empty")}
        </p>
      ) : (
        <ul
          className="max-h-80 divide-y divide-border/60 overflow-y-auto"
          data-testid="notifications-list"
        >
          {invitations.map((invitation) => {
            const pending = pendingId === invitation.id;
            const expired =
              invitation.expiresAt !== null && invitation.expiresAt <= now;
            const inviter =
              invitation.invitedByName ??
              invitation.invitedByEmail ??
              t("notifications.someone");
            return (
              <li
                key={invitation.id}
                data-testid="invitation-row"
                data-role={invitation.role}
                className="space-y-1.5 p-3"
              >
                <p className="truncate text-sm font-medium">
                  {invitation.boardTitle}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("notifications.invitedBy", { name: inviter })}
                  {" · "}
                  {t(ROLE_KEYS[invitation.role])}
                  {invitation.role === "VIEWER" &&
                  invitation.expiresAt !== null ? (
                    <span className={cn(expired && "text-danger")}>
                      {" · "}
                      {t("notifications.expires", {
                        date: formatDateOnly(invitation.expiresAt, lang),
                      })}
                      {expired ? ` (${t("notifications.expired")})` : ""}
                    </span>
                  ) : null}
                </p>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    data-testid="invitation-accept"
                    disabled={pending || expired}
                    onClick={() => void handleAccept(invitation)}
                    className="h-7 gap-1 px-2 text-xs"
                  >
                    <Check className="h-3.5 w-3.5" />
                    {t("notifications.accept")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid="invitation-decline"
                    disabled={pending}
                    onClick={() => void handleDecline(invitation)}
                    className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                    {t("notifications.decline")}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
