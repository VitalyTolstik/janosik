import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  CalendarClock,
  Check,
  ChevronDown,
  LogOut,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  LIMITS,
  type BoardMemberDto,
  type BoardPendingInvitationDto,
  type BoardRole,
} from "@janosik/shared";

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
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
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

/**
 * Maps an API failure onto one of the member-specific toast messages. An
 * invite never answers "no such user" — the server does not reveal whether
 * an account exists — so a `409` (already a member) is the only invite-
 * specific refusal.
 */
/** Four roster rows: the invite form below must not jump into place. */
function BoardMembersSkeleton() {
  return (
    <div className="divide-y divide-border/60" aria-hidden="true">
      {Array.from({ length: 4 }, (_, index) => (
        <div
          key={index}
          className="flex h-[52px] items-center gap-2.5 px-3"
          data-testid="board-members-skeleton-row"
        >
          <Skeleton variant="circle" width={28} height={28} />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton width={120} height={14} />
            <Skeleton width={180} height={10} />
          </div>
          <Skeleton width={64} height={20} className="rounded" />
        </div>
      ))}
    </div>
  );
}

function membershipError(error: unknown, t: Translate): string {
  if (error instanceof ApiError) {
    if (error.offline) return t("board.members.errors.offline");
    if (error.status === 409) {
      return error.code === "last_admin"
        ? t("board.members.lastAdmin")
        : t("board.members.errors.alreadyMember");
    }
    if (error.status === 403) return t("board.members.errors.forbidden");
  }
  return t("board.members.errors.generic");
}

/** A deadline the server would accept but the user could never meet. */
function isPastDeadline(value: number | null): boolean {
  return value !== null && value <= Date.now();
}

interface RolePickerProps {
  value: BoardRole;
  /** Accessible name (the row's user is baked in by the caller). */
  label: string;
  disabled?: boolean;
  /** Row-sized trigger (h-8/text-ui-label) instead of the form-sized one. */
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
              ? "h-8 min-w-[6.5rem] px-2 text-ui-label"
              : "h-9 min-w-[7.5rem] px-2.5 text-ui-body",
          )}
        >
          {t(ROLE_KEYS[value])}
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-44 p-1"
        // Escape closes this picker only, not the member dialog around it.
        onEscapeKeyDown={(event) => event.stopPropagation()}
      >
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
                "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-ui-body transition-colors hover:bg-hover",
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
          className="h-8 gap-1.5 px-2 text-ui-label font-normal text-muted-foreground"
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
      <PopoverContent
        align="end"
        className="relative w-auto p-3"
        // Escape closes the calendar only, not the member dialog around it.
        onEscapeKeyDown={(event) => event.stopPropagation()}
      >
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
  // A deadline in the past can never be met: offering yesterday only ends in
  // a successful invite the bell hides again. The invite form refuses an
  // already-lapsed deadline before it reaches the API.
  const today = new Date();
  today.setHours(0, 0, 0, 0);

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
        disabled={{ before: today }}
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
  const { board, roleOf, leaveBoard } = useBoard();
  const [open, setOpen] = useState(false);

  // A successful leave navigates to another board; leaving the modal open
  // would show that board's roster and keep the header behind a modal.
  const leaveAndClose = useCallback(
    async (boardId: string) => {
      const left = await leaveBoard(boardId);
      if (left) setOpen(false);
      return left;
    },
    [leaveBoard],
  );

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
        <DialogContent
          className="w-[calc(100vw-1.5rem)] sm:max-w-xl"
          onEscapeKeyDown={(event) => {
            // A nested calendar must consume the first Escape: close only the
            // picker, keep the member dialog open for the next action.
            if (document.querySelector('[data-testid="expiry-calendar"]')) {
              event.preventDefault();
            }
          }}
        >
          <BoardMembersPanel
            // A board switch must never leave the previous roster on screen.
            key={board.id}
            boardId={board.id}
            boardTitle={board.title}
            canManage={canManage}
            onLeave={leaveAndClose}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

interface BoardMembersPanelProps {
  boardId: string;
  /** Visible in the dialog header so a roster is never context-free. */
  boardTitle?: string;
  /** ADMIN may invite/change roles/remove; others see the same list inert. */
  canManage: boolean;
  /**
   * Leave the board as the caller (TASK-177.2). The dialog passes the
   * provider action; standalone mounts without it simply render no leave
   * control. Resolves `false` when the server refused (a toast is shown).
   */
  onLeave?: (boardId: string) => Promise<boolean>;
  /** Overrides `useAuth().user.id` in component tests. */
  currentUserId?: string;
}

export function BoardMembersPanel({
  boardId,
  boardTitle,
  canManage,
  onLeave,
  currentUserId,
}: BoardMembersPanelProps) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { user } = useAuth();
  const selfId = currentUserId ?? user?.id;
  const openProfile = useOpenProfile();
  const leaveReasonId = useId();
  const leaveButtonRef = useRef<HTMLButtonElement | null>(null);
  const leaveConfirmRef = useRef<HTMLButtonElement | null>(null);
  const wasConfirmingRef = useRef(false);

  const [members, setMembers] = useState<BoardMemberDto[] | null>(null);
  const [pending, setPending] = useState<BoardPendingInvitationDto[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // Frozen at mount so the "access expired" badges don't call `Date.now()`
  // during render (react-hooks/purity); the panel remounts on every open.
  const [now] = useState(() => Date.now());

  // Invite draft — remount-reset (see the file header), never `open`-reset.
  const [email, setEmail] = useState("");
  const [inviteEmailError, setInviteEmailError] = useState(false);
  const [inviteExpiryError, setInviteExpiryError] = useState(false);
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
      const [nextMembers, nextPending] = await Promise.all([
        // M15: only the admin's management list asks for lapsed VIEWER rows;
        // an ordinary read-only member list stays the active roster.
        api.listMembers(boardId, { includeExpired: canManage }),
        canManage
          ? api.listPendingInvitations(boardId).catch(() => [])
          : Promise.resolve([]),
      ]);
      setMembers(nextMembers);
      setPending(nextPending);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [boardId, canManage]);

  // The directory is rewritten on every membership event (someone accepted
  // an invitation, a role moved, another admin removed someone) — reload so
  // an open list is never stale (TASK-36).
  const membersVersion = useMembersVersion();
  useEffect(() => {
    void load();
  }, [load, membersVersion]);

  // A confirmation trap for keyboard users: opening moves focus to the
  // destructive Yes, cancelling returns it to the Leave action.
  useEffect(() => {
    if (confirmLeave) {
      wasConfirmingRef.current = true;
      leaveConfirmRef.current?.focus();
      return;
    }
    if (wasConfirmingRef.current) {
      wasConfirmingRef.current = false;
      leaveButtonRef.current?.focus();
    }
  }, [confirmLeave]);

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
    const input = event.currentTarget.querySelector<HTMLInputElement>(
      'input[type="email"]',
    );
    if (!input || !input.validity.valid) {
      setInviteEmailError(true);
      input?.focus();
      return;
    }
    if (role === "VIEWER" && expiry !== null && expiry <= Date.now()) {
      setInviteExpiryError(true);
      return;
    }
    setInviteEmailError(false);
    setInviteExpiryError(false);
    setInviting(true);
    try {
      const address = email.trim();
      await api.inviteMember(boardId, {
        email: address,
        role,
        expiresAt:
          role === "VIEWER" && expiry !== null
            ? new Date(expiry).toISOString()
            : undefined,
      });
      // The answer is the same masked projection (`userId: ""`) for every
      // address, so the toast cannot promise delivery — only that a
      // Janosik account at that address will see the invitation.
      toast.success(t("board.members.invite.success", { email: address }));
      setEmail("");
      setRole("MEMBER");
      setExpiry(null);
      setInviteExpiryError(false);
      // The invitation is pending until the invitee accepts — it must not
      // show up as a member yet (and the masked answer is no member row),
      // so the list is refetched.
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
    if (isPastDeadline(value)) {
      toast.error(t("board.members.expires.past"));
      return;
    }
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

  /** Keep a pending row in sync with the member row `PATCH` answers. */
  const replacePending = (updated: BoardMemberDto) => {
    setPending((prev) =>
      prev.map((row) =>
        row.userId === updated.userId
          ? { ...row, role: updated.role, expiresAt: updated.expiresAt }
          : row,
      ),
    );
  };

  async function handlePendingRoleChange(
    invitation: BoardPendingInvitationDto,
    next: BoardRole,
  ) {
    if (next === invitation.role) return;
    setPendingUserId(invitation.userId);
    try {
      replacePending(
        await api.updateMember(boardId, invitation.userId, { role: next }),
      );
      toast.success(t("board.members.roleChanged"));
    } catch (error) {
      toast.error(membershipError(error, t));
    } finally {
      setPendingUserId(null);
    }
  }

  async function handlePendingExpiryChange(
    invitation: BoardPendingInvitationDto,
    value: number | null,
  ) {
    if (isPastDeadline(value)) {
      toast.error(t("board.members.expires.past"));
      return;
    }
    setPendingUserId(invitation.userId);
    try {
      replacePending(
        await api.updateMember(boardId, invitation.userId, {
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

  async function handleLeave() {
    if (onLeave === undefined) return;
    setLeaving(true);
    try {
      const left = await onLeave(boardId);
      setConfirmLeave(false);
      // A last-admin refusal must not leave the button armed on a stale
      // roster: re-read the directory so the disabled reason is current.
      if (!left) await load();
    } finally {
      setLeaving(false);
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

  /** Cancel a pending invitation; the invitee's bell loses it on next load. */
  async function handleCancelInvitation(invitation: BoardPendingInvitationDto) {
    setPendingUserId(invitation.userId);
    try {
      await api.removeMember(boardId, invitation.userId);
      setPending((prev) => prev.filter((row) => row.id !== invitation.id));
      toast.success(t("board.members.pending.cancelled"));
    } catch (error) {
      toast.error(membershipError(error, t));
    } finally {
      setPendingUserId(null);
    }
  }

  return (
    <>
      <DialogHeader className="shrink-0">
        <DialogTitle className="text-ui-title font-semibold">
          {members === null
            ? t("board.members.titlePlain")
            : t("board.members.title", { count: members.length })}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {t("board.members.button")}
        </DialogDescription>
        {boardTitle ? (
          <p
            data-testid="board-members-board-title"
            className="truncate text-ui-body text-muted-foreground"
          >
            {boardTitle}
          </p>
        ) : null}
      </DialogHeader>

      {members === null && !loadFailed ? (
        <SkeletonRegion
          label={t("board.members.loading")}
          testId="board-members-skeleton"
          delayMs={150}
        >
          <BoardMembersSkeleton />
        </SkeletonRegion>
      ) : members === null ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger/5 p-3 text-ui-body">
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
          aria-busy={members === null}
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
              className="h-6 w-full bg-transparent text-ui-body outline-none placeholder:text-muted-foreground"
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
              <li className="px-3 py-6 text-center text-ui-body text-muted-foreground">
                {t("board.members.noMatches")}
              </li>
            ) : null}
            {visibleMembers?.map((member) => {
              const label = userLabel(member.displayName, member.email);
              const locked = isLastAdmin(member);
              const pending = pendingUserId === member.userId;
              const isSelf = selfId !== undefined && member.userId === selfId;
              const expired =
                member.expiresAt !== null && member.expiresAt <= now;
              return (
                <li
                  key={member.userId}
                  data-testid="board-member-row"
                  data-role={member.role}
                  data-user-id={member.userId}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3 sm:flex-nowrap sm:px-4"
                >
                  <button
                    type="button"
                    data-testid="board-member-open"
                    aria-label={t("profile.open", { name: label })}
                    onClick={() => openProfile(member.userId)}
                    className="flex w-full min-w-0 flex-1 items-center gap-3 rounded-md text-left transition-opacity hover:opacity-80 sm:w-auto"
                  >
                    <UserAvatar
                      userId={member.userId}
                      displayName={member.displayName}
                      email={member.email}
                      color={member.avatarColor}
                      avatarPath={member.avatarPath}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="flex min-w-0 items-center gap-1.5 truncate text-ui-body font-medium">
                        <span className="truncate">{label}</span>
                        {member.userId === user?.id ? (
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-ui-micro font-normal text-muted-foreground">
                            {t("board.members.you")}
                          </span>
                        ) : null}
                      </p>
                      <p className="truncate text-ui-label text-muted-foreground">
                        {member.email}
                      </p>
                      {member.role === "VIEWER" ? (
                        <p
                          className={cn(
                            "truncate text-ui-label",
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

                  {isSelf && onLeave !== undefined ? (
                    <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1.5 sm:flex-nowrap">
                      {canManage ? (
                        // Keep the admin's existing self-role control; only
                        // the self-remove is replaced by Leave.
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
                      ) : (
                        <span className="text-ui-label text-muted-foreground">
                          {t(ROLE_KEYS[member.role])}
                        </span>
                      )}
                      {confirmLeave ? (
                        <span
                          data-testid="member-leave-confirm"
                          className="flex shrink-0 items-center gap-0.5 rounded-md border border-danger/30 bg-danger/5 p-0.5 pl-2"
                        >
                          <span className="pr-1 text-ui-label text-muted-foreground">
                            {t("board.members.leaveConfirm")}
                          </span>
                          <Button
                            ref={leaveConfirmRef}
                            variant="ghost"
                            size="icon"
                            aria-label={t("board.members.leaveConfirmYes")}
                            disabled={leaving || locked}
                            onClick={() => void handleLeave()}
                            className="h-7 w-7 text-danger hover:bg-danger/10 hover:text-(--chip-red)"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t("common.cancel")}
                            disabled={leaving}
                            onClick={() => setConfirmLeave(false)}
                            className="h-7 w-7 text-muted-foreground hover:bg-hover hover:text-foreground"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </span>
                      ) : (
                        <span
                          title={
                            locked
                              ? t("board.members.lastAdminLeave")
                              : undefined
                          }
                        >
                          <span id={leaveReasonId} className="sr-only">
                            {t("board.members.lastAdminLeave")}
                          </span>
                          <Button
                            ref={leaveButtonRef}
                            variant="ghost"
                            size="sm"
                            aria-label={`${t("board.members.leave")} — ${label}`}
                            aria-describedby={
                              locked ? leaveReasonId : undefined
                            }
                            data-testid="board-member-leave"
                            disabled={locked || leaving}
                            onClick={() => setConfirmLeave(true)}
                            className="h-8 gap-1.5 px-2 text-ui-label font-normal text-muted-foreground hover:text-danger"
                          >
                            <LogOut size={14} />
                            {t("board.members.leave")}
                          </Button>
                        </span>
                      )}
                    </div>
                  ) : canManage ? (
                    <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1 sm:flex-nowrap">
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
                            className="h-6 w-6 text-danger hover:bg-danger/10 hover:text-(--chip-red)"
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
                    <span className="shrink-0 text-ui-label text-muted-foreground">
                      {t(ROLE_KEYS[member.role])}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {canManage && pending.length > 0 ? (
        <div
          className="shrink-0 space-y-1 rounded-lg border border-dashed bg-muted/20 p-3"
          data-testid="board-pending-list"
        >
          <p className="text-ui-micro font-medium uppercase text-muted-foreground">
            {t("board.members.pending.title", { count: pending.length })}
          </p>
          <ul className="space-y-1">
            {pending.map((invitation) => {
              const expired =
                invitation.expiresAt !== null && invitation.expiresAt <= now;
              const roleLabel = t(ROLE_KEYS[invitation.role]);
              const expiryValue =
                invitation.expiresAt === null
                  ? t("board.members.expires.never")
                  : formatDateOnly(invitation.expiresAt, lang);
              return (
                <li
                  key={invitation.id}
                  data-testid="board-pending-row"
                  className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md px-1.5 py-1.5 text-ui-body"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className="min-w-0 truncate">{invitation.email}</span>
                    {expired ? (
                      <span
                        data-testid="board-pending-expired"
                        className="shrink-0 rounded bg-danger/10 px-1 py-0.5 text-ui-micro font-medium uppercase tracking-wide text-danger"
                      >
                        {t("board.members.pending.expired")}
                      </span>
                    ) : null}
                  </div>
                  <span className="flex shrink-0 items-center gap-1">
                    {invitation.role === "VIEWER" ? (
                      <ExpiryPicker
                        value={invitation.expiresAt}
                        label={t("board.members.pending.expiresAria", {
                          name: invitation.email,
                          value: expiryValue,
                        })}
                        disabled={pendingUserId === invitation.userId}
                        onChange={(value) =>
                          void handlePendingExpiryChange(invitation, value)
                        }
                      />
                    ) : null}
                    <RolePicker
                      compact
                      value={invitation.role}
                      label={t("board.members.pending.roleAria", {
                        name: invitation.email,
                        role: roleLabel,
                      })}
                      disabled={pendingUserId === invitation.userId}
                      onChange={(next) =>
                        void handlePendingRoleChange(invitation, next)
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-danger"
                      aria-label={t("board.members.pending.cancel", {
                        email: invitation.email,
                      })}
                      data-testid="board-pending-cancel"
                      disabled={pendingUserId === invitation.userId}
                      onClick={() => void handleCancelInvitation(invitation)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {canManage ? (
        <form
          noValidate
          onSubmit={handleInvite}
          data-testid="board-members-invite"
          className="shrink-0 space-y-3 rounded-lg border bg-muted/30 p-4"
        >
          <p className="text-ui-label font-medium text-muted-foreground">
            {t("board.members.invite.title")}
          </p>
          <div className="flex gap-2">
            <Input
              type="email"
              invalid={inviteEmailError}
              aria-describedby={
                inviteEmailError ? "invite-email-error" : undefined
              }
              required
              value={email}
              aria-label={t("board.members.invite.email")}
              placeholder={t("board.members.invite.emailPlaceholder")}
              onChange={(event) => {
                setEmail(event.target.value);
                setInviteEmailError(false);
              }}
              className="h-9 flex-1"
            />
            <RolePicker
              value={role}
              label={t("board.members.invite.role")}
              onChange={setRole}
            />
          </div>
          {inviteEmailError && (
            <p
              id="invite-email-error"
              role="alert"
              className="text-ui-body text-danger"
            >
              {t("auth.validation.emailInvalid")}
            </p>
          )}
          {role === "VIEWER" ? (
            <div className="space-y-1">
              <label className="flex items-center gap-2 text-ui-label text-muted-foreground">
                {t("board.members.invite.expires")}
                <ExpiryPicker
                  value={expiry}
                  label={t("board.members.invite.expires")}
                  onChange={(value) => {
                    setExpiry(value);
                    setInviteExpiryError(false);
                  }}
                />
              </label>
              {inviteExpiryError ? (
                <p role="alert" className="text-ui-body text-danger">
                  {t("board.members.expires.past")}
                </p>
              ) : null}
            </div>
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
