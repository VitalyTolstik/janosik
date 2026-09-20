import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  CalendarClock,
  Check,
  ChevronDown,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { LIMITS, type BoardMemberDto, type BoardRole } from "@janosik/shared";

import { api, ApiError, isApiEnabled } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import {
  TimePickerPanel,
  TimePickerTrigger,
} from "@/components/board/TimePicker";
import { useOpenProfile } from "@/components/board/UserProfileDialog";
import { useToast } from "@/components/Toast";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar-lazy";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { LazyAnimatedIcon } from "@/components/ui/lazy-animated-icon";
import { LimitCounter } from "@/components/ui/limit-counter";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { UserAvatar } from "@/components/ui/user-avatar";
import {
  formatDateOnly,
  formatTime,
  useHour12,
  useI18n,
  type MessageKey,
} from "@/i18n";
import { cn } from "@/lib/utils";
import { useBoard } from "@/store/BoardContext";
import { useMembersVersion } from "@/store/board-live";
import { userLabel } from "@/utils/avatar";
import { composeTimestamp, formatTimeOfDay } from "@/utils/time";

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

interface RolePickerProps {
  value: BoardRole;
  /** Accessible name (the row's user is baked in by the caller). */
  label: string;
  disabled?: boolean;
  /** Row-sized trigger (h-8/text-xs) instead of the form-sized one. */
  compact?: boolean;
  onChange: (role: BoardRole) => void;
}

/**
 * Role picker: an outline trigger showing the current role, opening a popover
 * of radio rows with the project's check-mark idiom (FilterBar/CoverPicker) —
 * a native `<select>` looks like a browser control in the dark theme and
 * cannot be styled to match the rest of the board chrome.
 */
function RolePicker({
  value,
  label,
  disabled = false,
  compact = false,
  onChange,
}: RolePickerProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-label={label}
          data-testid="role-trigger"
          className={cn(
            "justify-between gap-1.5 font-normal",
            compact
              ? "h-8 min-w-[6.5rem] px-2 text-xs"
              : "h-9 min-w-[7.5rem] px-2.5 text-sm",
          )}
        >
          {t(ROLE_KEYS[value])}
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-1">
        <div role="radiogroup" aria-label={label}>
          {ROLES.map((role) => (
            <button
              key={role}
              type="button"
              role="radio"
              aria-checked={role === value}
              data-testid="role-option"
              onClick={() => {
                setOpen(false);
                onChange(role);
              }}
              className={cn(
                "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-hover",
                role === value
                  ? "font-medium text-foreground"
                  : "text-foreground/90",
              )}
            >
              {t(ROLE_KEYS[role])}
              {role === value && <Check className="h-3.5 w-3.5 text-primary" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface ExpiryPickerProps {
  /** Unix ms, or `null` for "no expiry". */
  value: number | null;
  /** Accessible name (the row's user is baked in by the caller). */
  label: string;
  disabled?: boolean;
  onChange: (value: number | null) => void;
}

/**
 * Access-expiry picker: a trigger showing the current deadline (or "no
 * expiry") that opens the same premium calendar + time-wheel used by card
 * due dates — instead of a native `datetime-local` field whose dark-theme
 * affordance is nearly invisible.
 */
function ExpiryPicker({
  value,
  label,
  disabled = false,
  onChange,
}: ExpiryPickerProps) {
  const { t, lang } = useI18n();
  const hour12 = useHour12();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          data-testid="expiry-trigger"
          aria-label={label}
          className="h-8 gap-1.5 px-2 text-xs font-normal text-muted-foreground"
        >
          <CalendarClock className="h-3.5 w-3.5" />
          {value === null
            ? t("board.members.expires.never")
            : `${formatDateOnly(value, lang)}, ${formatTime(
                formatTimeOfDay(new Date(value)),
                lang,
                hour12,
              )}`}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="relative w-auto p-3">
        {/* Draft state lives here: Radix unmounts the content on close, so
            every open mounts a clean calendar (AGENT.md). */}
        <ExpiryCalendarBody value={value} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}

function ExpiryCalendarBody({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const { t, lang } = useI18n();
  const [timeOpen, setTimeOpen] = useState(false);
  const [time, setTime] = useState(() =>
    value === null ? "12:00" : formatTimeOfDay(new Date(value)),
  );
  const due = value === null ? undefined : new Date(value);

  const applyTime = (next: string) => {
    setTime(next);
    if (due) onChange(composeTimestamp(due, next));
  };

  return (
    <div data-testid="expiry-calendar">
      {timeOpen ? (
        <div
          data-testid="expiry-time-panel"
          className="absolute -bottom-px right-full mr-2 rounded-md border border-border bg-popover p-2 shadow-md animate-in fade-in slide-in-from-right-1"
        >
          <TimePickerPanel
            value={time}
            onChange={applyTime}
            onConfirm={() => setTimeOpen(false)}
          />
        </div>
      ) : null}
      <Calendar
        mode="single"
        localeTag={lang}
        selected={due}
        onSelect={(date) => {
          if (date) onChange(composeTimestamp(date, time));
        }}
      />
      <div className="mt-1 flex items-center gap-2 border-t border-border/60 pt-2">
        <TimePickerTrigger
          value={time}
          active={timeOpen}
          onToggle={() => setTimeOpen((current) => !current)}
        />
        {value === null ? null : (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => onChange(null)}
            data-testid="expiry-clear"
          >
            <X className="h-3.5 w-3.5" />
            {t("board.members.expires.clear")}
          </Button>
        )}
      </div>
    </div>
  );
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
            <LazyAnimatedIcon name="user-plus" size={18} aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("board.members.button")}</TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[calc(100vw-1.5rem)] sm:max-w-xl">
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
  const openProfile = useOpenProfile();

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
  const [expiry, setExpiry] = useState<number | null>(null);
  const [inviting, setInviting] = useState(false);

  // Client-side filter over the roster — boards can hold a lot of members,
  // and the list scrolls inside the dialog.
  const [memberQuery, setMemberQuery] = useState("");
  const needle = memberQuery.trim().toLowerCase();
  const visibleMembers =
    members === null
      ? null
      : members.filter(
          (member) =>
            needle === "" ||
            (member.displayName ?? "").toLowerCase().includes(needle) ||
            member.email.toLowerCase().includes(needle),
        );

  const load = useCallback(async () => {
    try {
      setMembers(await api.listMembers(boardId));
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [boardId]);

  // The directory is rewritten on every membership event (someone accepted
  // an invitation, a role moved, another admin removed someone) — reload so
  // an open list is never stale (TASK-36).
  const membersVersion = useMembersVersion();
  useEffect(() => {
    void load();
  }, [load, membersVersion]);

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
          role === "VIEWER" && expiry !== null
            ? new Date(expiry).toISOString()
            : undefined,
      });
      toast.success(
        t("board.members.invite.success", { email: invited.email }),
      );
      setEmail("");
      setRole("MEMBER");
      setExpiry(null);
      // The invitation is pending until the invitee accepts — it must not
      // show up as a member yet, so the list is refetched.
      await load();
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

  async function handleExpiryChange(
    member: BoardMemberDto,
    value: number | null,
  ) {
    setPendingUserId(member.userId);
    try {
      replaceMember(
        await api.updateMember(boardId, member.userId, {
          expiresAt: value === null ? null : new Date(value).toISOString(),
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
      <DialogHeader className="shrink-0">
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
        // One bordered surface: the search header stays put while the roster
        // scrolls. `flex-1 min-h-0` lets the list take the dialog's spare
        // height (the dialog is capped to the viewport) instead of a fixed
        // max-height — 1000 members scroll inside, the form never leaves.
        <div
          className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border"
          data-testid="board-members-box"
        >
          <div className="relative flex shrink-0 items-center gap-2 border-b px-3 py-2.5">
            <Search size={15} className="shrink-0 text-muted-foreground" />
            <input
              name="member-search"
              value={memberQuery}
              maxLength={LIMITS.query}
              onChange={(event) => setMemberQuery(event.target.value)}
              placeholder={t("board.members.search")}
              aria-label={t("board.members.search")}
              className="h-6 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <LimitCounter
              length={memberQuery.length}
              limit={LIMITS.query}
              position="below"
              className="left-9"
              testId="members-search-limit"
            />
          </div>
          <ul
            className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto"
            data-testid="board-members-list"
          >
            {visibleMembers !== null && visibleMembers.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                {t("board.members.noMatches")}
              </li>
            ) : null}
            {visibleMembers?.map((member) => {
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
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <button
                    type="button"
                    data-testid="board-member-open"
                    aria-label={t("profile.open", { name: label })}
                    onClick={() => openProfile(member.userId)}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left transition-opacity hover:opacity-80"
                  >
                    <UserAvatar
                      userId={member.userId}
                      displayName={member.displayName}
                      email={member.email}
                      color={member.avatarColor}
                      avatarPath={member.avatarPath}
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
                  </button>

                  {canManage ? (
                    <div className="flex shrink-0 items-center gap-1">
                      {member.role === "VIEWER" ? (
                        <ExpiryPicker
                          value={member.expiresAt}
                          label={`${t("board.members.invite.expires")} — ${label}`}
                          disabled={pending}
                          onChange={(value) =>
                            void handleExpiryChange(member, value)
                          }
                        />
                      ) : null}
                      <span
                        title={
                          locked ? t("board.members.lastAdmin") : undefined
                        }
                      >
                        <RolePicker
                          compact
                          value={member.role}
                          label={t("board.members.roleAria", { name: label })}
                          disabled={pending || locked}
                          onChange={(next) =>
                            void handleRoleChange(member, next)
                          }
                        />
                      </span>

                      {confirmRemoveId === member.userId ? (
                        // Icon-only confirmation, same shape as the board
                        // card's archive confirm — no text buttons squeezing
                        // the row (and no overlap with the role/expiry pair).
                        <span
                          data-testid="member-remove-confirm"
                          className="flex shrink-0 items-center gap-0.5 rounded-md border border-danger/30 bg-danger/5 p-0.5"
                        >
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t("board.members.removeConfirmYes")}
                            disabled={pending}
                            onClick={() => void handleRemove(member)}
                            className="h-6 w-6 text-danger hover:bg-danger/10 hover:text-danger"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t("common.cancel")}
                            onClick={() => setConfirmRemoveId(null)}
                            className="h-6 w-6 text-muted-foreground hover:bg-hover hover:text-foreground"
                          >
                            <X className="h-3.5 w-3.5" />
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
        </div>
      )}

      {canManage ? (
        <form
          onSubmit={handleInvite}
          data-testid="board-members-invite"
          className="shrink-0 space-y-3 rounded-lg border bg-muted/30 p-4"
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
            <RolePicker
              value={role}
              label={t("board.members.invite.role")}
              onChange={setRole}
            />
          </div>
          {role === "VIEWER" ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              {t("board.members.invite.expires")}
              <ExpiryPicker
                value={expiry}
                label={t("board.members.invite.expires")}
                onChange={setExpiry}
              />
            </label>
          ) : null}
          <Button
            type="submit"
            disabled={inviting || email.trim() === ""}
            className="w-full"
          >
            {t("board.members.invite.submit")}
          </Button>
        </form>
      ) : null}
    </>
  );
}
