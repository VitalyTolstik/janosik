import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Trash2, Users } from "lucide-react";
import type { BoardMemberDto, BoardRole } from "@janosik/shared";

import { api, ApiError, isApiEnabled } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { useToast } from "@/components/Toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { UserAvatar } from "@/components/ui/user-avatar";
import { formatDateOnly, useI18n, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { useBoard } from "@/store/BoardContext";
import { userLabel } from "@/utils/avatar";
import { pad2 } from "@/utils/time";

/**
 * «Участники» dialog (TASK-35): the only place a second person can be added
 * to a board from the UI. Admins invite by email, change roles, bound a
 * VIEWER's access with an expiry and remove members — all backed by the
 * TASK-25 endpoints. Everyone else gets the same list read-only. The last
 * ADMIN cannot be demoted or removed, so a board can never be orphaned.
 *
 * All draft state lives in `BoardMembersPanel`, which Radix unmounts when
 * the dialog closes: each open remounts a clean panel (fresh fetch + empty
 * invite form) without an imperative reset (AGENT.md).
 */

const ROLES: readonly BoardRole[] = ["ADMIN", "MEMBER", "VIEWER"];

const ROLE_KEYS = {
  ADMIN: "board.members.role.admin",
  MEMBER: "board.members.role.member",
  VIEWER: "board.members.role.viewer",
} satisfies Record<BoardRole, MessageKey>;

type Translate = ReturnType<typeof useI18n>["t"];

/** `datetime-local` value (local time, minute precision) for a Unix-ms instant. */
function toDateTimeInput(ms: number): string {
  const date = new Date(ms);
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
    `T${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  );
}

/** Maps an API failure onto one of the member-specific toast messages. */
function membershipError(error: unknown, t: Translate): string {
  if (error instanceof ApiError) {
    if (error.offline) return t("board.members.errors.offline");
    if (error.status === 404) return t("board.members.errors.userNotFound");
    if (error.status === 409) return t("board.members.errors.alreadyMember");
    if (error.status === 403) return t("board.members.errors.forbidden");
  }
  return t("board.members.errors.generic");
}

export function BoardMembersDialog() {
  const { t } = useI18n();
  const { board, roleOf } = useBoard();
  const [open, setOpen] = useState(false);

  // Members are a server-only concept; the local (localStorage) mode has a
  // single implicit admin and no membership table.
  if (!isApiEnabled() || !board) return null;
  const canManage = roleOf(board.id) === "ADMIN";

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("board.members.button")}
            onClick={() => setOpen(true)}
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
          >
            <Users size={18} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("board.members.button")}</TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <BoardMembersPanel boardId={board.id} canManage={canManage} />
        </DialogContent>
      </Dialog>
    </>
  );
}

interface BoardMembersPanelProps {
  boardId: string;
  /** ADMIN may invite/change roles/remove; others see the same list inert. */
  canManage: boolean;
}

export function BoardMembersPanel({
  boardId,
  canManage,
}: BoardMembersPanelProps) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { user } = useAuth();

  const [members, setMembers] = useState<BoardMemberDto[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  // Frozen at mount so the "access expired" badges don't call `Date.now()`
  // during render (react-hooks/purity); the panel remounts on every open.
  const [now] = useState(() => Date.now());

  // Invite draft — remount-reset (see the file header), never `open`-reset.
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<BoardRole>("MEMBER");
  const [expiry, setExpiry] = useState("");
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    try {
      setMembers(await api.listMembers(boardId));
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [boardId]);

  useEffect(() => {
    void load();
  }, [load]);

  const adminCount =
    members?.filter((member) => member.role === "ADMIN").length ?? 0;
  const isLastAdmin = (member: BoardMemberDto) =>
    member.role === "ADMIN" && adminCount <= 1;

  const replaceMember = (updated: BoardMemberDto) => {
    setMembers(
      (prev) =>
        prev?.map((member) =>
          member.userId === updated.userId ? updated : member,
        ) ?? null,
    );
  };

  async function handleInvite(event: FormEvent) {
    event.preventDefault();
    if (email.trim() === "") return;
    setInviting(true);
    try {
      const invited = await api.inviteMember(boardId, {
        email: email.trim(),
        role,
        expiresAt:
          role === "VIEWER" && expiry !== ""
            ? new Date(expiry).toISOString()
            : undefined,
      });
      toast.success(
        t("board.members.invite.success", { email: invited.email }),
      );
      setEmail("");
      setRole("MEMBER");
      setExpiry("");
      setMembers((prev) => (prev === null ? null : [...prev, invited]));
    } catch (error) {
      toast.error(membershipError(error, t));
    } finally {
      setInviting(false);
    }
  }

  async function handleRoleChange(member: BoardMemberDto, next: BoardRole) {
    if (next === member.role) return;
    setPendingUserId(member.userId);
    try {
      replaceMember(
        await api.updateMember(boardId, member.userId, { role: next }),
      );
      toast.success(t("board.members.roleChanged"));
    } catch (error) {
      toast.error(membershipError(error, t));
    } finally {
      setPendingUserId(null);
    }
  }

  async function handleExpiryChange(member: BoardMemberDto, value: string) {
    setPendingUserId(member.userId);
    try {
      replaceMember(
        await api.updateMember(boardId, member.userId, {
          expiresAt: value === "" ? null : new Date(value).toISOString(),
        }),
      );
      toast.success(t("board.members.expiryChanged"));
    } catch (error) {
      toast.error(membershipError(error, t));
    } finally {
      setPendingUserId(null);
    }
  }

  async function handleRemove(member: BoardMemberDto) {
    setPendingUserId(member.userId);
    try {
      await api.removeMember(boardId, member.userId);
      setMembers(
        (prev) => prev?.filter((row) => row.userId !== member.userId) ?? null,
      );
      setConfirmRemoveId(null);
      toast.success(t("board.members.removed"));
    } catch (error) {
      toast.error(membershipError(error, t));
    } finally {
      setPendingUserId(null);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-base font-semibold">
          {members === null
            ? t("board.members.titlePlain")
            : t("board.members.title", { count: members.length })}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {t("board.members.button")}
        </DialogDescription>
      </DialogHeader>

      {members === null && !loadFailed ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t("board.members.loading")}
        </p>
      ) : members === null ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm">
          <span>{t("board.members.loadFailed")}</span>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            {t("board.members.retry")}
          </Button>
        </div>
      ) : (
        <ul
          className="max-h-72 divide-y divide-border/60 overflow-y-auto rounded-lg border"
          data-testid="board-members-list"
        >
          {members.map((member) => {
            const label = userLabel(member.displayName, member.email);
            const locked = isLastAdmin(member);
            const pending = pendingUserId === member.userId;
            const expired =
              member.expiresAt !== null && member.expiresAt <= now;
            return (
              <li
                key={member.userId}
                data-testid="board-member-row"
                data-role={member.role}
                data-user-id={member.userId}
                className="flex items-center gap-3 p-3"
              >
                <UserAvatar
                  userId={member.userId}
                  displayName={member.displayName}
                  email={member.email}
                />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                    {label}
                    {member.userId === user?.id ? (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                        {t("board.members.you")}
                      </span>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {member.email}
                  </p>
                  {member.role === "VIEWER" ? (
                    <p
                      className={cn(
                        "truncate text-xs",
                        expired ? "text-danger" : "text-muted-foreground",
                      )}
                    >
                      {member.expiresAt === null
                        ? t("board.members.expires.never")
                        : t("board.members.expires.until", {
                            date: formatDateOnly(member.expiresAt, lang),
                          })}
                      {expired
                        ? ` · ${t("board.members.expires.expired")}`
                        : ""}
                    </p>
                  ) : null}
                </div>

                {canManage ? (
                  <div className="flex shrink-0 items-center gap-1">
                    {member.role === "VIEWER" ? (
                      <input
                        type="datetime-local"
                        value={
                          member.expiresAt === null
                            ? ""
                            : toDateTimeInput(member.expiresAt)
                        }
                        disabled={pending}
                        aria-label={`${t("board.members.invite.expires")} — ${label}`}
                        onChange={(event) =>
                          void handleExpiryChange(member, event.target.value)
                        }
                        className="h-8 w-[8.5rem] rounded-md border border-border bg-background px-1.5 text-[11px] text-muted-foreground"
                      />
                    ) : null}
                    <span
                      title={locked ? t("board.members.lastAdmin") : undefined}
                    >
                      <select
                        value={member.role}
                        disabled={pending || locked}
                        aria-label={t("board.members.roleAria", {
                          name: label,
                        })}
                        onChange={(event) =>
                          void handleRoleChange(
                            member,
                            event.target.value as BoardRole,
                          )
                        }
                        className="h-8 rounded-md border border-border bg-background px-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {ROLES.map((value) => (
                          <option key={value} value={value}>
                            {t(ROLE_KEYS[value])}
                          </option>
                        ))}
                      </select>
                    </span>
                    {member.role === "VIEWER" && member.expiresAt !== null ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t("board.members.expires.clear")}
                            disabled={pending}
                            onClick={() => void handleExpiryChange(member, "")}
                            className="h-7 w-7 text-muted-foreground"
                          >
                            ∞
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("board.members.expires.clear")}
                        </TooltipContent>
                      </Tooltip>
                    ) : null}

                    {confirmRemoveId === member.userId ? (
                      <span className="flex items-center gap-1">
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={pending}
                          onClick={() => void handleRemove(member)}
                          className="h-7 px-2 text-[11px]"
                        >
                          {t("board.members.removeConfirmYes")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmRemoveId(null)}
                          className="h-7 px-2 text-[11px]"
                        >
                          {t("common.cancel")}
                        </Button>
                      </span>
                    ) : (
                      <span
                        title={
                          locked ? t("board.members.lastAdmin") : undefined
                        }
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`${t("board.members.remove")} — ${label}`}
                          disabled={pending || locked}
                          onClick={() => setConfirmRemoveId(member.userId)}
                          className="h-7 w-7 text-muted-foreground hover:text-danger"
                        >
                          <Trash2 size={14} />
                        </Button>
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {t(ROLE_KEYS[member.role])}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canManage ? (
        <form
          onSubmit={handleInvite}
          data-testid="board-members-invite"
          className="space-y-2 rounded-lg border bg-muted/30 p-3"
        >
          <p className="text-xs font-medium text-muted-foreground">
            {t("board.members.invite.title")}
          </p>
          <div className="flex gap-2">
            <Input
              type="email"
              required
              value={email}
              aria-label={t("board.members.invite.email")}
              placeholder={t("board.members.invite.emailPlaceholder")}
              onChange={(event) => setEmail(event.target.value)}
              className="h-9 flex-1"
            />
            <select
              value={role}
              aria-label={t("board.members.invite.role")}
              onChange={(event) => setRole(event.target.value as BoardRole)}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm"
            >
              {ROLES.map((value) => (
                <option key={value} value={value}>
                  {t(ROLE_KEYS[value])}
                </option>
              ))}
            </select>
          </div>
          {role === "VIEWER" ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              {t("board.members.invite.expires")}
              <input
                type="datetime-local"
                value={expiry}
                onChange={(event) => setExpiry(event.target.value)}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs"
              />
            </label>
          ) : null}
          <Button
            type="submit"
            size="sm"
            disabled={inviting || email.trim() === ""}
          >
            {t("board.members.invite.submit")}
          </Button>
        </form>
      ) : null}
    </>
  );
}
