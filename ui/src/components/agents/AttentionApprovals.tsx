import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleSlash,
  Clock,
  Copy,
  History,
  Link as LinkIcon,
  MoreHorizontal,
  RefreshCw,
  Shield,
  Terminal,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import type {
  AgentSessionDto,
  AgentsOverviewApprovalItem,
  ApprovalRequestDto,
  Board,
  BoardMemberDto,
} from "@janosik/shared";

import { api, ApiError } from "@/api/client";
import { deleteCardImpactSentence } from "@/components/approvals/approval-impact";
import {
  ApprovalDecisionForm,
  ApprovalDetailError,
  ApprovalLinks,
  ApprovalRiskBadge,
  ApprovalStatusBadge,
} from "@/components/approvals/approval-ui";
import { AgentConfirmDialog } from "./AgentConfirmDialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/Toast";
import { useI18n, type MessageKey } from "@/i18n";
import { routes } from "@/routes";
import { cn } from "@/lib/utils";
import { useBoardLive } from "@/store/board-live";
import {
  APPROVAL_STATUS_KEYS,
  effectiveApprovalStatus,
  formatApprovalMoment,
} from "@/utils/approval";
import { runNumber, shortTokenId } from "./agent-model";
import { actionSummary } from "./run-model";
import { AgentControlFooterPortal } from "./AgentControlFooterPortal";

export type AttentionApprovalFilter = "needs" | "decided" | "all";

export type AttentionApprovalRow = AgentsOverviewApprovalItem & {
  /** Token name when a live session from the same token is known. */
  agentName?: string;
};

type ApprovalStatus = keyof typeof APPROVAL_STATUS_KEYS;

const RISK_SHORT_KEYS: Record<ApprovalRequestDto["risk"], string> = {
  low: "agents.approvals.risk.low",
  medium: "agents.approvals.risk.medium",
  high: "agents.approvals.risk.high",
};

function minutesLeft(expiresAt: number, now: number): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 60_000));
}

function lengthOfPlan(approval: ApprovalRequestDto): number {
  return (
    (approval.plan?.commands?.length ?? 0) +
    (approval.plan?.operations?.length ?? 0)
  );
}

function titleForApproval(
  approval: Pick<AgentsOverviewApprovalItem, "actionType" | "summary">,
  cardTitle: string | null,
  t: Translate,
): string {
  // A known card title is the real target; the seeded summary is not a
  // reliable title source (legacy rows say `Delete card '…'` with straight
  // quotes, some plans say `Apply …`). Keep the summary only as a fallback
  // when the card is gone or unknown.
  if (approval.actionType === "DELETE_CARD" && cardTitle !== null) {
    return t("agents.approvals.deleteCardTitle", { card: cardTitle });
  }
  return approval.summary;
}

/** The human target of one plan command: the card/column the plan names. */
function planCommandTarget(
  action: Record<string, unknown> & { type: string },
  board: Board | null,
): string {
  const target = actionSummary(
    action as unknown as Parameters<typeof actionSummary>[0],
    board ?? undefined,
  );
  if (target !== "") return target;
  const title = action.title;
  return typeof title === "string" ? title : action.type;
}

function statusHint(
  status: ApprovalStatus,
  expiresAt: number,
  now: number,
  t: Translate,
  applyWindowExpired: boolean,
): { tone: "warn" | "ok" | "bad" | "muted"; icon: ReactNode; text: string } {
  switch (status) {
    case "approved":
      // An approved decision is intentionally not rewritten to `expired`
      // when its apply window lapses (the agent's apply gets
      // `approval_expired`). Explain the wedged state instead of pretending
      // the plan is still applicable.
      if (applyWindowExpired) {
        return {
          tone: "warn",
          icon: <Clock className="h-3.5 w-3.5" aria-hidden />,
          text: t("agents.approvals.banner.approvedWindowExpired"),
        };
      }
      return {
        tone: "ok",
        icon: <Check className="h-3.5 w-3.5" aria-hidden />,
        text: t("agents.approvals.banner.approved"),
      };
    case "rejected":
      return {
        tone: "bad",
        icon: <X className="h-3.5 w-3.5" aria-hidden />,
        text: t("agents.approvals.banner.rejected"),
      };
    case "expired":
      return {
        tone: "warn",
        icon: <Clock className="h-3.5 w-3.5" aria-hidden />,
        text: t("agents.approvals.banner.expired"),
      };
    case "cancelled":
      return {
        tone: "muted",
        icon: <CircleSlash className="h-3.5 w-3.5" aria-hidden />,
        text: t("agents.approvals.banner.cancelled"),
      };
    case "consumed":
      return {
        tone: "ok",
        icon: <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />,
        text: t("agents.approvals.banner.consumed"),
      };
    case "pending":
    default:
      return {
        tone: "warn",
        icon: <Clock className="h-3.5 w-3.5" aria-hidden />,
        text: t("agents.approvals.banner.pending", {
          minutes: minutesLeft(expiresAt, now),
        }),
      };
  }
}

function DetailSection({
  title,
  icon,
  aside,
  children,
  last = false,
  first = false,
}: {
  title: string;
  icon?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  last?: boolean;
  first?: boolean;
}) {
  return (
    <section
      className={cn(
        "py-2.5",
        first && "mt-2.5",
        !last && "border-b border-border/60",
      )}
      data-testid={`approval-section-${title.toLowerCase().replaceAll(" ", "-")}`}
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        {icon !== undefined ? (
          <span className="text-muted-foreground [&_svg]:h-3 [&_svg]:w-3">
            {icon}
          </span>
        ) : null}
        <h3 className="text-[11px] font-[650] tracking-[0.03em]">{title}</h3>
        {aside !== undefined ? <span className="ml-auto">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

type Translate = ReturnType<typeof useI18n>["t"];

function decisionError(error: unknown, t: Translate): string {
  if (error instanceof ApiError && error.offline) {
    return t("agentControl.error.offline");
  }
  const code =
    error instanceof ApiError &&
    error.body !== null &&
    typeof error.body === "object"
      ? (error.body as { code?: unknown }).code
      : undefined;
  switch (code) {
    case "approval_expired":
      return t("agentControl.error.expired");
    case "approval_not_pending":
      return t("agentControl.error.notPending");
    case "approval_mismatch":
      return t("agentControl.error.mismatch");
    case "approval_owner_mismatch":
      return t("agentControl.error.ownerMismatch");
    case "pat_forbidden":
      return t("agentControl.error.sessionOnly");
    default:
      break;
  }
  if (error instanceof ApiError && error.status === 403) {
    return t("agentControl.error.forbidden");
  }
  return t("agentControl.error.generic");
}

function useNow(intervalMs = 10_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function AttentionApprovalList({
  rows,
  serverCounts,
  filter,
  onFilterChange,
  selectedId,
  onSelect,
  onReject,
  now,
  loading = false,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
}: {
  rows: readonly AttentionApprovalRow[];
  serverCounts?: { pending: number; decided: number; total: number } | null;
  filter: AttentionApprovalFilter;
  onFilterChange: (filter: AttentionApprovalFilter) => void;
  selectedId: string | null;
  onSelect: (row: AttentionApprovalRow) => void;
  onReject: (row: AttentionApprovalRow) => void;
  now: number;
  loading?: boolean;
  /** A server page remains after the loaded rows (M24). */
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}) {
  const { t, tp, lang } = useI18n();
  const counts = useMemo(() => {
    if (serverCounts)
      return {
        needs: serverCounts.pending,
        decided: serverCounts.decided,
        all: serverCounts.total,
      };
    let needs = 0;
    for (const row of rows) {
      if (
        effectiveApprovalStatus(row.status, row.expiresAt, now) === "pending"
      ) {
        needs += 1;
      }
    }
    return { needs, decided: rows.length - needs, all: rows.length };
  }, [now, rows, serverCounts]);
  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        const pending =
          effectiveApprovalStatus(row.status, row.expiresAt, now) === "pending";
        if (filter === "needs") return pending;
        if (filter === "decided") return !pending;
        return true;
      }),
    [filter, now, rows],
  );

  if (loading && rows.length === 0)
    return (
      <section
        aria-busy="true"
        data-testid="agents-approvals-loading"
        className="space-y-2"
      >
        <div className="mb-1 flex items-center justify-between gap-3">
          <Skeleton width={170} height={12} />
          <Skeleton width={96} height={11} />
        </div>
        {[0, 1].map((index) => (
          <div
            key={index}
            aria-hidden
            className="rounded-[8px] border border-border bg-[color-mix(in_oklab,var(--surface)_58%,var(--background))] px-3 pt-[11px] pb-2.5"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <Skeleton width={112} height={10} />
              <Skeleton width={64} height={10} />
              <Skeleton width={72} height={10} />
            </div>
            <Skeleton className="mt-2" width="72%" height={13} />
            <Skeleton className="mt-1.5" width="92%" height={10} />
            <div className="mt-2 flex items-center gap-1.5">
              <Skeleton width={62} height={20} className="rounded-[5px]" />
              <Skeleton width={82} height={20} className="rounded-[5px]" />
            </div>
          </div>
        ))}
        <div className="space-y-1.5 pt-2" aria-hidden>
          <Skeleton width="52%" height={10} />
          <Skeleton width="68%" height={10} />
        </div>
      </section>
    );
  if (rows.length === 0 && !hasMore && !serverCounts?.total) return null;

  const decidedView = filter === "decided";
  const heading = decidedView
    ? t("agents.approvals.decidedHeading")
    : counts.needs === 1
      ? t("agents.approvals.oneWaiting")
      : counts.needs > 1
        ? t("agents.approvals.manyWaiting", { count: counts.needs })
        : t("agents.approvals.noneWaiting");

  return (
    <section data-testid="agents-approvals">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            counts.needs > 0 ? "bg-warning" : "bg-success",
          )}
          aria-hidden
        />
        <h2 className="text-[12.5px] font-[650]">{heading}</h2>
        <span className="text-[11px] text-muted-foreground">
          {decidedView
            ? t("agents.approvals.decidedSubtitle")
            : t("agents.approvals.sortedByExpiry")}
        </span>
        <div
          role="group"
          aria-label={t("agents.approvals.filterLabel")}
          className="ml-auto flex items-center gap-2"
        >
          {(
            [
              ["needs", "agents.approvals.needs", "needs"],
              ["decided", "agents.approvals.decided", "decided"],
              ["all", "agents.approvals.all", "all"],
            ] as const
          ).map(([value, key, countKey]) => (
            <button
              key={value}
              type="button"
              data-testid={`agents-approvals-filter-${value}`}
              aria-pressed={filter === value}
              onClick={() => onFilterChange(value)}
              className={cn(
                "inline-flex min-h-11 items-center gap-1 text-[11px] transition-colors md:min-h-0",
                filter === value
                  ? "font-semibold text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(key)}
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {counts[countKey]}
              </span>
            </button>
          ))}
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-success/70" aria-hidden />
          {filter === "needs"
            ? t("agents.approvals.emptyNeeds")
            : t("agents.approvals.emptyDecided")}
        </div>
      ) : (
        <ul className="space-y-2" data-testid="agents-approval-list">
          {filtered.map((row) => {
            const effective = effectiveApprovalStatus(
              row.status,
              row.expiresAt,
              now,
            );
            const title = titleForApproval(row, row.cardTitle ?? null, t);
            const timeLabel =
              effective === "pending"
                ? t("agents.approvals.expiresIn", {
                    count: minutesLeft(row.expiresAt, now),
                  })
                : formatApprovalMoment(row.decidedAt ?? row.expiresAt, lang, t);
            const cardKindKey =
              row.kind === "destructive"
                ? row.cardTitle !== null
                  ? "destructiveCard"
                  : "destructive"
                : row.kind;
            const cardKindSentence = t(
              `agents.approvals.cardKind.${cardKindKey}` as MessageKey,
              { card: row.cardTitle ?? "" },
            );
            const destructiveCard =
              row.actionType === "DELETE_CARD" && row.cardTitle !== null;
            return (
              <li key={row.id}>
                <article
                  data-status={effective}
                  className={cn(
                    "relative overflow-hidden rounded-[8px] border px-3 pt-[11px] pb-2.5 pl-3.5 transition-colors",
                    effective === "pending"
                      ? "border-border bg-[color-mix(in_oklab,var(--warning)_4%,var(--surface))] hover:bg-[color-mix(in_oklab,var(--warning)_7%,var(--surface))]"
                      : "border-border bg-[color-mix(in_oklab,var(--surface)_58%,var(--background))] hover:bg-[color-mix(in_oklab,var(--surface)_72%,var(--background))]",
                    selectedId === row.id &&
                      "border-[color-mix(in_oklab,var(--warning)_36%,var(--border))] bg-[color-mix(in_oklab,var(--warning)_4%,var(--surface))]",
                    effective === "pending" &&
                      "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-warning",
                  )}
                >
                  <button
                    type="button"
                    data-testid={`agents-approval-${row.id}`}
                    aria-current={selectedId === row.id}
                    onClick={() => onSelect(row)}
                    className="flex w-full flex-col text-left"
                  >
                    <span className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="font-[650] uppercase tracking-[0.06em] text-[color:var(--warning)]">
                        {t(`agents.approvals.eyebrow.${effective}`)}
                      </span>
                      <span className="text-border">·</span>
                      <span>{row.boardTitle}</span>
                      <span className="text-border">·</span>
                      <span>{timeLabel}</span>
                      <ApprovalRiskBadge risk={row.risk} />
                    </span>
                    <span className="mb-[3px] block text-[13px] leading-[1.35] font-[650] text-foreground">
                      {title}
                    </span>
                    <span className="block text-[11.5px] leading-[1.5] text-muted-foreground">
                      <b className="font-semibold text-foreground">
                        {row.agentName ?? shortTokenId(row.requestedByTokenId)}
                      </b>{" "}
                      {t("agents.approvals.asksPrefix")}{" "}
                      <code className="font-mono text-[11.5px]">
                        {row.actionType}
                      </code>
                      {destructiveCard ? (
                        <>
                          {". "}
                          {deleteCardImpactSentence(
                            row.cardTitle ?? "",
                            row.impact,
                            t,
                            tp,
                            lang,
                          )}
                        </>
                      ) : (
                        <>
                          {" "}
                          {t("agents.approvals.asksOn")}{" "}
                          <b className="font-semibold text-foreground">
                            {row.cardTitle == null
                              ? row.boardTitle
                              : `${t("agents.approvals.targetCard")} ${row.cardTitle}`}
                          </b>
                          {row.kind === "custom" ? null : (
                            <>
                              {". "}
                              {cardKindSentence}
                            </>
                          )}
                        </>
                      )}
                    </span>
                  </button>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Button
                      size="sm"
                      onClick={() => onSelect(row)}
                      data-testid={`agents-approval-review-${row.id}`}
                      className="h-7 min-h-0 gap-1.5 rounded-[6px] !bg-[var(--agent-primary-strong)] px-[9px] text-[11px] leading-none font-[650] shadow-[inset_0_1px_0_rgb(255_255_255/0.16)] hover:!bg-[color-mix(in_oklab,var(--agent-primary-strong)_88%,#fff)] max-md:min-h-11"
                    >
                      {t("agents.approvals.reviewPlan")}
                    </Button>
                    {effective === "pending" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onReject(row)}
                        data-testid={`agents-approval-reject-${row.id}`}
                        className="h-7 min-h-0 gap-1.5 rounded-[6px] bg-[color-mix(in_oklab,var(--surface)_65%,transparent)] px-[9px] text-[11px] leading-none font-[650] max-md:min-h-11"
                      >
                        {t("agents.approvals.reject")}
                      </Button>
                    ) : null}
                    <code className="ml-auto hidden truncate font-mono text-[11px] text-muted-foreground md:block">
                      {t("agents.approvals.hash", {
                        hash: row.planHash.slice(0, 10),
                      })}
                    </code>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
      {hasMore && onLoadMore !== undefined ? (
        <div className="mt-2 flex justify-center">
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="agents-approvals-load-more"
            disabled={loadingMore}
            onClick={onLoadMore}
            className="min-h-11 rounded-[6px] px-3 text-[11px] font-semibold md:min-h-7"
          >
            {loadingMore ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : null}
            {t("agentControl.runs.loadMore")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

interface AttentionApprovalDetailProps {
  boardId: string;
  approvalId: string;
  boardTitle: string;
  fallbackAgentName?: string;
  fallbackCardTitle?: string;
  /** Quick-reject from the list opens the footer reject form directly. */
  initialMode?: "reject" | null;
  /** Global panel keeps list context; the board panel shows the cancel action. */
  variant?: "global" | "board";
  /** Mobile list-only state hides the board footer until a detail is open. */
  footerActive?: boolean;
  focusBack?: boolean;
  onChanged: () => void;
  onBack?: () => void;
  onNextPending?: () => void;
  onCancelRequest?: () => Promise<boolean>;
}

export function AttentionApprovalDetail(props: AttentionApprovalDetailProps) {
  return (
    <ApprovalDetail key={`${props.boardId}:${props.approvalId}`} {...props} />
  );
}

function ApprovalDetail({
  boardId,
  approvalId,
  boardTitle,
  fallbackAgentName,
  fallbackCardTitle,
  initialMode = null,
  variant = "global",
  footerActive = true,
  focusBack = false,
  onChanged,
  onBack,
  onNextPending,
  onCancelRequest,
}: AttentionApprovalDetailProps) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const live = useBoardLive();
  const [detail, setDetail] = useState<ApprovalRequestDto | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0);
  const backButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusBack) backButton.current?.focus();
  }, [focusBack]);
  const [hashCopied, setHashCopied] = useState(false);
  const [board, setBoard] = useState<Board | null>(null);
  const [members, setMembers] = useState<BoardMemberDto[]>([]);
  const [sessions, setSessions] = useState<AgentSessionDto[]>([]);
  const [tokenNames, setTokenNames] = useState<Map<string, string>>(
    () => new Map(),
  );
  // `GET /users/me/tokens` is owner-only. A fulfilled read is the ownership
  // boundary: an id missing from it belongs to another member, so the token
  // stays read-only. A failed read is unknown and also fails closed.
  const [ownTokensKnown, setOwnTokensKnown] = useState(false);
  const now = useNow();

  // An external approve/reject/consume must re-read the detail. The board
  // shell's stream is authoritative when it covers this board; the timer is
  // the cross-board fallback for the global console, never the source of
  // truth (the server reply still decides the buttons).
  useEffect(
    () =>
      live.agentControl.subscribeApproval((event) => {
        if (event.approvalId === approvalId) {
          setRevision((value) => value + 1);
        }
      }),
    [approvalId, live],
  );
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) setRevision((value) => value + 1);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [approvalId]);

  useEffect(() => {
    const request = ++generation.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- keep the mounted detail while reading its new revision
    setRefreshing(true);
    void api
      .getApproval(boardId, approvalId)
      .then((next) => {
        if (request !== generation.current) return;
        setDetail(next);
        setError(false);
      })
      .catch((error: unknown) => {
        if (request !== generation.current) return;
        if (
          error instanceof ApiError &&
          (error.status === 403 || error.status === 404)
        ) {
          setDetail(null);
        }
        setError(true);
      })
      .finally(() => {
        if (request === generation.current) setRefreshing(false);
      });
    return () => {
      generation.current += 1;
    };
  }, [approvalId, boardId, revision]);

  useEffect(() => {
    let alive = true;
    void Promise.allSettled([
      api.getBoard(boardId),
      api.listMembers(boardId),
      api.listAgentSessions(boardId),
      typeof api.listTokens === "function"
        ? api.listTokens()
        : Promise.resolve([]),
    ]).then(([boardResult, membersResult, sessionsResult, tokensResult]) => {
      if (!alive) return;
      if (boardResult.status === "fulfilled") setBoard(boardResult.value);
      if (membersResult.status === "fulfilled") setMembers(membersResult.value);
      if (sessionsResult.status === "fulfilled")
        setSessions(sessionsResult.value);
      if (tokensResult.status === "fulfilled") {
        setTokenNames(
          new Map(tokensResult.value.map((token) => [token.id, token.name])),
        );
        setOwnTokensKnown(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [boardId]);

  const effectiveStatus =
    detail === null
      ? undefined
      : effectiveApprovalStatus(detail.status, detail.expiresAt, now);
  const applyWindowExpired =
    detail !== null && detail.status === "approved" && detail.expiresAt <= now;
  const canDecide = effectiveStatus === "pending";
  const commandCount = detail === null ? 0 : lengthOfPlan(detail);

  const memberName = (userId: string | null): string | null => {
    if (userId === null) return null;
    const member = members.find((row) => row.userId === userId);
    return member?.displayName ?? member?.email ?? null;
  };

  const session =
    detail === null
      ? undefined
      : detail.agentSessionId !== null
        ? sessions.find((row) => row.id === detail.agentSessionId)
        : sessions.find((row) => row.apiTokenId === detail.requestedByTokenId);
  const tokenName =
    detail === null ? undefined : tokenNames.get(detail.requestedByTokenId);
  // Attribution is the token (name first, id second), never the session:
  // one token can drive several sessions, and the session has its own field.
  const agentName =
    tokenName ??
    session?.tokenName ??
    fallbackAgentName ??
    (detail === null ? "" : shortTokenId(detail.requestedByTokenId));
  const tokenOwnership =
    detail === null
      ? "unknown"
      : tokenNames.has(detail.requestedByTokenId)
        ? "own"
        : ownTokensKnown
          ? "other"
          : "unknown";
  const boardLabel = board?.title ?? boardTitle;
  const boardCard =
    detail?.cardId != null ? board?.cards[detail.cardId] : undefined;
  const cardTitle = boardCard?.title ?? fallbackCardTitle ?? null;
  const requestedBy =
    memberName(detail?.requestedBy ?? null) ?? detail?.requestedBy ?? "";
  const decidedBy =
    memberName(detail?.decidedBy ?? null) ?? detail?.decidedBy ?? null;
  const ttlMinutes =
    detail === null
      ? 0
      : Math.max(0, Math.round((detail.expiresAt - detail.createdAt) / 60_000));
  const hint =
    detail !== null && effectiveStatus !== undefined
      ? statusHint(
          effectiveStatus,
          detail.expiresAt,
          now,
          t,
          applyWindowExpired,
        )
      : null;

  const copyHash = async () => {
    if (detail === null) return;
    try {
      await navigator.clipboard.writeText(detail.planHash);
    } catch {
      const area = document.createElement("textarea");
      area.value = detail.planHash;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setHashCopied(true);
    toast.success(t("agents.approvals.copiedToast"));
  };

  const decide = async (
    decision: "approve" | "reject",
    comment: string,
  ): Promise<boolean> => {
    if (detail === null) return false;
    setBusy(true);
    try {
      const updated = await api.decideApproval(boardId, detail.id, {
        decision,
        planHash: detail.planHash,
        ...(comment === "" ? {} : { comment }),
      });
      // The decision response does not recompute impact; keep the counts the
      // detail read already proved instead of blanking the paragraph.
      generation.current += 1;
      setRefreshing(false);
      setError(false);
      setDetail({
        ...updated,
        impact: updated.impact ?? detail.impact,
      });
      onChanged();
      toast.success(
        decision === "approve"
          ? t("agentControl.approvals.approvedToast")
          : t("agentControl.approvals.rejectedToast"),
      );
      return true;
    } catch (submitError) {
      toast.error(decisionError(submitError, t));
      setRevision((value) => value + 1);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const toneClasses = {
    warn: "border-[color-mix(in_oklab,var(--warning)_34%,var(--border))] bg-[color-mix(in_oklab,var(--warning)_6%,transparent)] [&_svg]:text-[color:var(--warning)]",
    ok: "border-[color-mix(in_oklab,var(--success)_32%,var(--border))] bg-[color-mix(in_oklab,var(--success)_6%,transparent)] [&_svg]:text-[color:var(--agent-tone-success)]",
    bad: "border-[color-mix(in_oklab,var(--danger)_32%,var(--border))] bg-[color-mix(in_oklab,var(--danger)_6%,transparent)] [&_svg]:text-[color:var(--agent-tone-danger)]",
    muted:
      "border-border bg-muted/40 text-muted-foreground [&_svg]:text-muted-foreground",
  } as const;

  const cancelRequest = async (): Promise<boolean> => {
    if (detail === null) return false;
    setCancelBusy(true);
    try {
      if (onCancelRequest !== undefined) {
        const ok = await onCancelRequest();
        if (!ok) return false;
      } else {
        const updated = await api.cancelApproval(boardId, detail.id);
        generation.current += 1;
        setRefreshing(false);
        setError(false);
        setDetail({ ...updated, impact: updated.impact ?? detail.impact });
      }
      onChanged();
      toast.success(t("agentControl.approvals.cancelledToast"));
      return true;
    } catch (error) {
      toast.error(
        error instanceof ApiError && error.offline
          ? t("agentControl.error.offline")
          : t("agentControl.approvals.cancelError"),
      );
      return false;
    } finally {
      setCancelBusy(false);
      setCancelOpen(false);
    }
  };

  const footerNode =
    detail !== null && effectiveStatus !== undefined && hint !== null ? (
      <footer
        className={cn(
          "ac-foot ac-foot-static shrink-0 border-t border-border",
          variant === "board"
            ? "ac-foot-approval bg-[color-mix(in_oklab,var(--surface)_82%,var(--background))] px-3 py-[9px]"
            : "bg-[color-mix(in_oklab,var(--surface)_84%,var(--background))] px-3.5 py-2.5 max-md:px-3 max-md:py-[9px]",
        )}
      >
        {canDecide ? (
          <ApprovalDecisionForm
            key={`${detail.id}-${initialMode ?? "idle"}`}
            busy={busy}
            planHash={detail.planHash}
            footerHash={variant === "board" ? detail.planHash : undefined}
            layout={variant === "board" ? "inline" : "stacked"}
            onNextPending={
              variant === "board" || onNextPending === undefined
                ? undefined
                : onNextPending
            }
            impactTitle={
              t("agents.runs.commandCount", { count: commandCount }) + "."
            }
            impactText={`${detail.summary.replace(/[.\s]+$/, "")}.${cardTitle === null ? "" : ` ${t("agents.approvals.targetLabel", { target: cardTitle })}`}`}
            initialMode={initialMode}
            onDecide={decide}
          />
        ) : (
          <div className="flex w-full items-center gap-2">
            <p className="flex flex-1 items-start gap-1.5 text-[11px] leading-[1.45] text-muted-foreground">
              <span className="mt-px shrink-0">{hint.icon}</span>
              <span>{hint.text}</span>
            </p>
            {variant === "global" &&
            effectiveStatus === "approved" &&
            onNextPending !== undefined ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                data-testid="approval-next-pending"
                onClick={onNextPending}
                className="h-7 min-h-0 shrink-0 rounded-[6px] px-[9px] text-[11px] leading-none font-[650] text-muted-foreground hover:text-foreground max-md:min-h-11"
              >
                {t("agents.approvals.nextPending")}
              </Button>
            ) : null}
            {onBack !== undefined ? (
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn(
                    "min-h-0 rounded-[6px] leading-none font-[650] max-md:min-h-11",
                    variant === "board"
                      ? "h-7 px-[9px] text-[11px]"
                      : "h-8 px-[11px] text-[11.5px]",
                  )}
                  onClick={onBack}
                >
                  {variant === "global"
                    ? t("agents.approvals.closeDetail")
                    : t("common.close")}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </footer>
    ) : null;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="agents-approval-detail"
    >
      <header
        className={cn(
          "shrink-0 border-b border-border px-3.5",
          variant === "board" ? "pt-[11px] pb-[9px]" : "pt-3 pb-2",
        )}
      >
        <div className="flex items-start gap-2">
          {onBack ? (
            <button
              type="button"
              ref={backButton}
              onClick={onBack}
              aria-label={t("agents.approvals.back")}
              className={cn(
                "mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded border border-border text-muted-foreground hover:bg-hover hover:text-foreground",
                variant === "board"
                  ? "min-[761px]:hidden"
                  : "min-[1061px]:hidden",
              )}
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
          <div className="min-w-0 flex-1">
            {variant === "global" ? (
              <p className="mb-[3px] text-[11px] font-[650] uppercase tracking-[0.04em] text-muted-foreground">
                {t("agents.approvals.selected")}
              </p>
            ) : null}
            <h2
              className={cn(
                "break-words tracking-[-0.01em]",
                variant === "board"
                  ? "font-agent-display text-[15px] font-[700] leading-[1.3]"
                  : "text-[13px] font-[650] leading-[1.35]",
              )}
            >
              {detail === null
                ? t("agents.approvals.loading")
                : titleForApproval(detail, cardTitle, t)}
            </h2>
            {variant === "board" && detail !== null ? (
              <div className="-mt-0.5 mb-2 flex flex-wrap items-center gap-1.5">
                {effectiveStatus !== undefined ? (
                  <ApprovalStatusBadge
                    status={effectiveStatus}
                    testId="approval-detail-status"
                  />
                ) : null}
                <ApprovalRiskBadge risk={detail.risk} />
                <span className="inline-flex h-[21px] items-center rounded-[5px] border border-border bg-[color-mix(in_oklab,var(--surface)_65%,transparent)] px-[7px] text-[11px] font-semibold leading-none text-muted-foreground">
                  {boardLabel}
                </span>
              </div>
            ) : null}
          </div>
          {refreshing && detail !== null ? (
            <span aria-label={t("agents.approvals.refreshing")} role="status">
              <RefreshCw
                className="h-3.5 w-3.5 animate-spin text-muted-foreground"
                aria-hidden
              />
            </span>
          ) : null}
          {variant === "board" && effectiveStatus === "pending" ? (
            <button
              type="button"
              onClick={() => setCancelOpen(true)}
              disabled={cancelBusy}
              data-testid="approval-cancel-menu"
              aria-label={t("agentControl.approvals.cancelRequest")}
              title={t("agentControl.approvals.cancelRequest")}
              className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[5px] text-muted-foreground hover:bg-hover hover:text-foreground max-md:h-11 max-md:w-11"
            >
              <MoreHorizontal className="!h-3.5 !w-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pt-3 pb-4">
        {error ? (
          <ApprovalDetailError onRetry={() => setRevision((v) => v + 1)} />
        ) : null}
        {detail === null ? (
          error ? null : (
            <div className="space-y-3" aria-hidden="true">
              <Skeleton width={220} height={18} />
              <Skeleton width={140} height={12} />
              <Skeleton width="100%" height={80} />
            </div>
          )
        ) : effectiveStatus === undefined || hint === null ? null : (
          <div>
            <div
              className={cn(
                "mb-2.5 flex items-start gap-2 rounded-[7px] border px-2.5 py-2 text-[11px] leading-[1.45]",
                toneClasses[hint.tone],
              )}
              role="status"
              aria-live="polite"
              data-testid="approval-status"
              data-status={effectiveStatus}
            >
              <span className="mt-px shrink-0">{hint.icon}</span>
              <span>{hint.text}</span>
            </div>

            <p className="text-[11.5px] leading-[1.55] text-foreground">
              <b className="font-semibold">{agentName}</b>{" "}
              {t("agents.approvals.asksPrefix")}{" "}
              <code className="font-mono text-[11.5px]">
                {detail.actionType}
              </code>{" "}
              {t("agents.approvals.asksOn")}{" "}
              <b className="font-semibold">{boardLabel}</b>.{" "}
              {t("agents.approvals.asksSuffix")}
            </p>

            <DetailSection title={t("agents.approvals.request")} first>
              <div className="grid grid-cols-2 gap-x-3 gap-y-[9px]">
                <RequestMeta label={t("agentControl.approvals.board")}>
                  {boardLabel}
                </RequestMeta>
                <RequestMeta label={t("agents.approvals.requestedBy")}>
                  {agentName}
                </RequestMeta>
                <RequestMeta label={t("agents.approvals.agent")}>
                  {session?.name === undefined &&
                  agentName === shortTokenId(detail.requestedByTokenId) ? (
                    <span className="font-mono text-[11px]">{agentName}</span>
                  ) : (
                    agentName
                  )}
                </RequestMeta>
                <RequestMeta label={t("agents.approvals.sessionLabel")}>
                  {detail.agentSessionId === null ? (
                    t("agentControl.approvals.noSession")
                  ) : session?.name !== undefined ? (
                    session.name
                  ) : (
                    <span className="font-mono text-[11px]">
                      {detail.agentSessionId}
                    </span>
                  )}
                </RequestMeta>
                <RequestMeta label={t("agents.approvals.target")}>
                  {detail.cardId === null ? (
                    `${t("agents.approvals.targetBoard")} · ${boardLabel}`
                  ) : (
                    <Link
                      to={`${routes.board(boardId)}?card=${encodeURIComponent(detail.cardId)}`}
                      className="hover:text-foreground hover:underline"
                      data-testid="agents-approval-card"
                    >
                      {`${t("agents.approvals.targetCard")} · ${cardTitle ?? detail.cardId}`}
                    </Link>
                  )}
                </RequestMeta>
                <RequestMeta
                  label={
                    effectiveStatus === "pending"
                      ? t("agents.approvals.expiresLabel")
                      : t("agents.approvals.requested")
                  }
                >
                  {effectiveStatus === "pending"
                    ? t("agents.approvals.inMinutes", {
                        count: minutesLeft(detail.expiresAt, now),
                      })
                    : formatApprovalMoment(detail.createdAt, lang, t)}
                </RequestMeta>
              </div>
            </DetailSection>

            <DetailSection
              title={t("agentControl.approvals.plan")}
              icon={<Terminal aria-hidden />}
              aside={
                <Chip>
                  {t("agents.approvals.commands", { count: commandCount })}
                </Chip>
              }
            >
              <p className="mb-1.5 text-[11.5px] leading-[1.5] text-foreground">
                {detail.summary}
              </p>
              <div
                className="flex flex-col gap-1.5"
                data-testid="approval-plan"
              >
                {(detail.plan?.commands ?? []).map((command) => (
                  <div
                    key={command.commandId}
                    className="rounded-[6px] border border-border bg-[color-mix(in_oklab,var(--background)_28%,transparent)] px-2 py-[7px]"
                    data-testid="approval-plan-command"
                  >
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="inline-flex h-[21px] items-center rounded-[4px] border border-border bg-[color-mix(in_oklab,var(--surface)_65%,transparent)] px-[6px] text-[11px] font-[600] text-foreground">
                        {String(command.action.type)}
                      </span>
                      <span className="min-w-0 truncate text-[11px] text-foreground">
                        {planCommandTarget(command.action, board)}
                      </span>
                      {command.action.type === "MOVE_CARD" && board !== null
                        ? (() => {
                            const action = command.action as Record<
                              string,
                              unknown
                            >;
                            const column = board.columns.find(
                              (entry) => entry.id === action.toColumnId,
                            );
                            return column === undefined ? null : (
                              <span>
                                {t("agents.approvals.toColumn", {
                                  column: column.title,
                                })}
                              </span>
                            );
                          })()
                        : null}
                    </div>
                  </div>
                ))}
                {(detail.plan?.operations ?? []).map((operation, index) => (
                  <div
                    key={`${operation.op}-${index}`}
                    className="rounded-[6px] border border-border bg-[color-mix(in_oklab,var(--background)_28%,transparent)] px-2 py-[7px]"
                    data-testid="approval-plan-operation"
                  >
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="inline-flex h-[21px] items-center rounded-[4px] border border-border bg-[color-mix(in_oklab,var(--surface)_65%,transparent)] px-[6px] text-[11px] font-[600] text-foreground">
                        {operation.op}
                      </span>
                    </div>
                  </div>
                ))}
                {commandCount === 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    {t("agentControl.approvals.noPlan")}
                  </p>
                ) : null}
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {t("agents.approvals.planHint")}
              </p>
            </DetailSection>

            <DetailSection
              title={t("agents.approvals.integrity")}
              icon={<Shield aria-hidden />}
              aside={<Chip>{t("agents.approvals.exactHash")}</Chip>}
            >
              <div className="flex min-w-0 items-center gap-1.5 rounded-[5px] border border-border bg-background/30 px-1.5 py-1">
                <code
                  data-testid="approval-plan-hash"
                  title={detail.planHash}
                  className="min-w-0 flex-1 overflow-hidden font-mono text-[11px] whitespace-nowrap text-ellipsis text-muted-foreground"
                >
                  {detail.planHash.slice(0, 44)}…
                </code>
                <button
                  type="button"
                  className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center self-center rounded-[5px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring max-md:h-11 max-md:w-11"
                  onClick={() => void copyHash()}
                  aria-label={t("agentControl.approvals.copyHash")}
                  data-testid="approval-copy-hash"
                >
                  {hashCopied ? (
                    <Check
                      className="h-3 w-3 text-[color:var(--agent-tone-success)]"
                      aria-hidden
                    />
                  ) : (
                    <Copy className="h-3 w-3 opacity-70" aria-hidden />
                  )}
                </button>
              </div>
              <p className="mt-1.5 text-[11px] leading-[1.5] text-muted-foreground">
                {t("agents.approvals.hashHint")}
              </p>
            </DetailSection>

            <DetailSection
              title={t("agents.approvals.decisionHistory")}
              icon={<History aria-hidden />}
            >
              <div className="flex flex-col gap-1.5">
                <HistoryItem
                  tone="ok"
                  title={t("agents.approvals.historyRequested", {
                    name: requestedBy,
                  })}
                  detail={t("agents.approvals.historyMeta", {
                    time: formatApprovalMoment(detail.createdAt, lang, t),
                    risk: t(RISK_SHORT_KEYS[detail.risk] as MessageKey),
                    ttl: ttlMinutes,
                  })}
                />
                {effectiveStatus === "pending" ? (
                  <HistoryItem
                    tone="warn"
                    title={t("agents.approvals.historyWaiting")}
                    detail={t("agents.approvals.waitingHistory", {
                      minutes: minutesLeft(detail.expiresAt, now),
                    })}
                  />
                ) : (
                  <HistoryItem
                    tone={
                      effectiveStatus === "rejected"
                        ? "bad"
                        : effectiveStatus === "expired"
                          ? "warn"
                          : effectiveStatus === "consumed"
                            ? "primary"
                            : "ok"
                    }
                    title={
                      decidedBy !== null
                        ? t("agents.approvals.historyDecision", {
                            status: t(APPROVAL_STATUS_KEYS[effectiveStatus]),
                            name: decidedBy,
                          })
                        : t(APPROVAL_STATUS_KEYS[effectiveStatus])
                    }
                    detail={`${formatApprovalMoment(
                      detail.decidedAt ?? detail.expiresAt,
                      lang,
                      t,
                    )}${
                      detail.decisionComment !== null
                        ? ` · “${detail.decisionComment}”`
                        : ""
                    }`}
                  />
                )}
                {detail.consumedAt !== null ? (
                  <HistoryItem
                    tone="primary"
                    title={
                      detail.runId === null
                        ? t("agents.approvals.historyApplied")
                        : t("agents.approvals.historyAppliedRun", {
                            run: t("agents.runHash", {
                              id: runNumber(detail.runId),
                            }),
                          })
                    }
                    detail={`${formatApprovalMoment(detail.consumedAt, lang, t)} · ${detail.summary}`}
                  />
                ) : null}
              </div>
            </DetailSection>

            <DetailSection
              title={t("agents.approvals.related")}
              icon={<LinkIcon aria-hidden />}
            >
              <ApprovalLinks
                approval={detail}
                tokenName={agentName}
                tokenOwnership={tokenOwnership}
              />
            </DetailSection>

            <details
              className="group mt-1.5 overflow-hidden rounded-md border border-border bg-background/30"
              data-testid="agents-approval-technical"
            >
              <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold text-muted-foreground [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  className="h-[11px] w-[11px] transition-transform group-open:rotate-90"
                  aria-hidden
                />
                {t("agents.approvals.technicalDetails")}
              </summary>
              <pre className="m-0 border-t border-border p-2 font-mono text-[11px] leading-[1.55] whitespace-pre-wrap break-words text-muted-foreground">
                {detail.plan === undefined
                  ? t("agentControl.approvals.noPlan")
                  : JSON.stringify(detail.plan ?? null, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
      {variant === "board" ? (
        <AgentControlFooterPortal active={footerActive}>
          {footerNode}
        </AgentControlFooterPortal>
      ) : (
        footerNode
      )}
      {variant === "board" ? (
        <AgentConfirmDialog
          open={cancelOpen}
          onOpenChange={setCancelOpen}
          icon={CircleSlash}
          tone="danger"
          title={t("agentControl.approvals.cancelTitle")}
          description={t("agentControl.approvals.cancelDescription")}
          confirmLabel={t("agentControl.approvals.cancelConfirm")}
          onConfirm={() => {
            void cancelRequest();
          }}
          busy={cancelBusy}
          testId="approval-cancel-dialog"
          confirmTestId="approval-cancel-confirm"
          cancelTestId="approval-cancel-cancel"
          confirmClassName="min-w-[107px]"
        >
          <p className="mt-2.5 rounded-r-[5px] border-l-2 border-warning bg-[color-mix(in_oklab,var(--warning)_6%,transparent)] px-2.5 py-2 text-[11px] leading-[1.5] text-foreground">
            {detail === null ? null : `${detail.summary} · ${agentName}`}
          </p>
        </AgentConfirmDialog>
      ) : null}
    </div>
  );
}

function RequestMeta({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <span className="mb-0.5 block text-[11px] tracking-[0.04em] text-[color:color-mix(in_oklab,var(--muted-foreground)_78%,transparent)] uppercase">
        {label}
      </span>
      <span className="block text-[11px] leading-[1.4] font-medium break-words text-foreground">
        {children}
      </span>
    </div>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-[21px] items-center rounded border border-border bg-[color-mix(in_oklab,var(--surface)_65%,transparent)] px-1.5 text-[11px] font-semibold whitespace-nowrap text-muted-foreground">
      {children}
    </span>
  );
}

function HistoryItem({
  tone,
  title,
  detail,
}: {
  tone: "ok" | "warn" | "bad" | "primary" | "muted";
  title: string;
  detail: string;
}) {
  const toneClass = {
    ok: "bg-success",
    warn: "bg-warning",
    bad: "bg-danger",
    primary: "bg-primary",
    muted: "bg-muted-foreground",
  } as const;
  return (
    <div className="flex items-start gap-[7px] text-[11px] leading-[1.4]">
      <span
        className={cn(
          "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
          toneClass[tone],
        )}
      />
      <span className="min-w-0">
        <b className="block font-semibold text-foreground">{title}</b>
        <span className="block text-muted-foreground">{detail}</span>
      </span>
    </div>
  );
}
