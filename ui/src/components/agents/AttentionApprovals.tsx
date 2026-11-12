import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleSlash,
  Clock,
  Copy,
  FileDiff,
  History,
  Link2,
  Shield,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import type {
  AgentSessionDto,
  ApprovalRequestDto,
  Board,
  BoardMemberDto,
} from "@janosik/shared";

import { api, ApiError } from "@/api/client";
import {
  ApprovalDecisionForm,
  ApprovalDetailError,
  ApprovalLinks,
  ApprovalRiskBadge,
} from "@/components/approvals/approval-ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/Toast";
import { formatDate, useI18n } from "@/i18n";
import { routes } from "@/routes";
import { cn } from "@/lib/utils";
import {
  APPROVAL_KIND_KEYS,
  APPROVAL_RISK_KEYS,
  APPROVAL_STATUS_KEYS,
  effectiveApprovalStatus,
} from "@/utils/approval";
import { shortId } from "./agent-model";

export type AttentionApprovalFilter = "needs" | "decided" | "all";

export interface AttentionApprovalRow extends ApprovalRequestDto {
  boardTitle: string;
  /** Token name when a live session from the same token is known. */
  agentName?: string;
  /** Card title when the loaded board aggregate has that card. */
  cardTitle?: string;
}

type ApprovalStatus = keyof typeof APPROVAL_STATUS_KEYS;

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
  approval: ApprovalRequestDto,
  cardTitle: string | null,
  t: Translate,
): string {
  if (
    approval.actionType === "DELETE_CARD" &&
    cardTitle !== null &&
    approval.summary.startsWith("Apply ")
  ) {
    return t("agents.approvals.deleteCardTitle", { card: cardTitle });
  }
  return approval.summary;
}

function statusHint(
  status: ApprovalStatus,
  expiresAt: number,
  now: number,
  t: Translate,
): { tone: "warn" | "ok" | "bad" | "muted"; icon: ReactNode; text: string } {
  switch (status) {
    case "approved":
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
}: {
  title: string;
  icon?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <section
      className={cn("py-2.5", !last && "border-b border-border/60")}
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
  filter,
  onFilterChange,
  selectedId,
  onSelect,
  onReject,
  now,
}: {
  rows: readonly AttentionApprovalRow[];
  filter: AttentionApprovalFilter;
  onFilterChange: (filter: AttentionApprovalFilter) => void;
  selectedId: string | null;
  onSelect: (row: AttentionApprovalRow) => void;
  onReject: (row: AttentionApprovalRow) => void;
  now: number;
}) {
  const { t, lang } = useI18n();
  const counts = useMemo(() => {
    let needs = 0;
    for (const row of rows) {
      if (
        effectiveApprovalStatus(row.status, row.expiresAt, now) === "pending"
      ) {
        needs += 1;
      }
    }
    return { needs, decided: rows.length - needs, all: rows.length };
  }, [now, rows]);
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

  if (rows.length === 0) return null;

  const heading =
    counts.needs === 1
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
        <span className="text-[10.5px] text-muted-foreground">
          {t("agents.approvals.sortedByExpiry")}
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
                "inline-flex items-center gap-1 text-[10.5px] transition-colors",
                filter === value
                  ? "font-semibold text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(key)}
              <span className="text-[10px] tabular-nums text-muted-foreground">
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
                ? t("agents.approvals.minLeft", {
                    count: minutesLeft(row.expiresAt, now),
                  })
                : formatDate(row.decidedAt ?? row.expiresAt, lang);
            return (
              <li key={row.id}>
                <article
                  data-status={effective}
                  className={cn(
                    "relative overflow-hidden rounded-lg border px-3 pt-2.5 pb-2.5 pl-3.5 transition-colors",
                    selectedId === row.id
                      ? "border-[color-mix(in_oklab,var(--warning)_36%,var(--border))] bg-[color-mix(in_oklab,var(--warning)_4%,var(--surface))]"
                      : "border-border bg-[color-mix(in_oklab,var(--surface)_58%,var(--background))] hover:bg-[color-mix(in_oklab,var(--surface)_72%,var(--background))]",
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
                    <span className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground">
                      <span className="font-[650] uppercase tracking-[0.06em] text-warning">
                        {t(`agents.approvals.eyebrow.${effective}`)}
                      </span>
                      <span className="text-border">·</span>
                      <span>{row.boardTitle}</span>
                      <span className="text-border">·</span>
                      <span>{timeLabel}</span>
                      <ApprovalRiskBadge risk={row.risk} />
                    </span>
                    <span className="mb-0.5 block text-[13px] font-[650] leading-[1.35] text-foreground">
                      {title}
                    </span>
                    <span className="block text-[11.5px] leading-[1.5] text-muted-foreground">
                      <b className="font-semibold text-foreground">
                        {row.agentName ?? shortId(row.requestedByTokenId, 12)}
                      </b>{" "}
                      {t("agents.approvals.asksPrefix")}{" "}
                      <code className="font-mono text-[10.5px]">
                        {row.actionType}
                      </code>
                      . {t(APPROVAL_KIND_KEYS[row.kind])}.
                    </span>
                  </button>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Button
                      size="sm"
                      onClick={() => onSelect(row)}
                      data-testid={`agents-approval-review-${row.id}`}
                      className="h-7 min-h-0 rounded-md px-2 text-[11px] font-[650]"
                    >
                      {t("agents.approvals.reviewPlan")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onReject(row)}
                      data-testid={`agents-approval-reject-${row.id}`}
                      className="h-7 min-h-0 rounded-md px-2 text-[11px] font-[650]"
                    >
                      {t("agents.approvals.reject")}
                    </Button>
                    <code className="ml-auto truncate font-mono text-[10px] text-muted-foreground/75">
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
    </section>
  );
}

export function AttentionApprovalDetail({
  boardId,
  approvalId,
  boardTitle,
  fallbackAgentName,
  fallbackCardTitle,
  initialMode = null,
  onChanged,
  onBack,
}: {
  boardId: string;
  approvalId: string;
  boardTitle: string;
  fallbackAgentName?: string;
  fallbackCardTitle?: string;
  /** Quick-reject from the list opens the footer reject form directly. */
  initialMode?: "reject" | null;
  onChanged: () => void;
  onBack?: () => void;
}) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [detail, setDetail] = useState<ApprovalRequestDto | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [hashCopied, setHashCopied] = useState(false);
  const [board, setBoard] = useState<Board | null>(null);
  const [members, setMembers] = useState<BoardMemberDto[]>([]);
  const [sessions, setSessions] = useState<AgentSessionDto[]>([]);
  const now = useNow();

  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the detail while the new request runs
    setError(false);
    setDetail(null);
    void api
      .getApproval(boardId, approvalId)
      .then((next) => {
        if (alive) setDetail(next);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [approvalId, boardId, revision]);

  useEffect(() => {
    let alive = true;
    void Promise.allSettled([
      api.getBoard(boardId),
      api.listMembers(boardId),
      api.listAgentSessions(boardId),
    ]).then(([boardResult, membersResult, sessionsResult]) => {
      if (!alive) return;
      if (boardResult.status === "fulfilled") setBoard(boardResult.value);
      if (membersResult.status === "fulfilled") setMembers(membersResult.value);
      if (sessionsResult.status === "fulfilled")
        setSessions(sessionsResult.value);
    });
    return () => {
      alive = false;
    };
  }, [boardId]);

  const effectiveStatus =
    detail === null
      ? undefined
      : effectiveApprovalStatus(detail.status, detail.expiresAt, now);
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
  const agentName =
    fallbackAgentName ??
    session?.name ??
    session?.clientName ??
    detail?.requestedByTokenId ??
    "";
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
      ? statusHint(effectiveStatus, detail.expiresAt, now, t)
      : null;

  const copyHash = () => {
    if (detail === null) return;
    const clipboard = navigator.clipboard;
    if (clipboard === undefined) return;
    void clipboard.writeText(detail.planHash).then(
      () => {
        setHashCopied(true);
        toast.success(t("agents.approvals.copiedToast"));
        window.setTimeout(() => setHashCopied(false), 1500);
      },
      () => undefined,
    );
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
      setDetail(updated);
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

  const cancel = async (): Promise<boolean> => {
    if (detail === null) return false;
    setBusy(true);
    try {
      const updated = await api.cancelApproval(boardId, detail.id);
      setDetail(updated);
      onChanged();
      toast.success(t("agentControl.approvals.cancelledToast"));
      return true;
    } catch (submitError) {
      toast.error(
        submitError instanceof ApiError && submitError.offline
          ? t("agentControl.error.offline")
          : t("agentControl.approvals.cancelError"),
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  const toneClasses = {
    warn: "border-warning/35 bg-[color-mix(in_oklab,var(--warning)_6%,transparent)] [&_svg]:text-warning",
    ok: "border-success/30 bg-[color-mix(in_oklab,var(--success)_6%,transparent)] [&_svg]:text-success",
    bad: "border-danger/35 bg-[color-mix(in_oklab,var(--danger)_6%,transparent)] [&_svg]:text-danger",
    muted:
      "border-border bg-muted/40 text-muted-foreground [&_svg]:text-muted-foreground",
  } as const;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="agents-approval-detail"
    >
      <header className="shrink-0 border-b border-border px-3.5 pt-3 pb-2">
        <div className="flex items-start gap-2">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              aria-label={t("agents.approvals.back")}
              className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded border border-border text-muted-foreground hover:bg-hover hover:text-foreground min-[1061px]:hidden"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
          <div className="min-w-0">
            <p className="text-[10px] font-[650] uppercase tracking-[0.07em] text-muted-foreground">
              {t("agents.approvals.selected")}
            </p>
            <h2 className="mt-0.5 text-[13px] font-[650] leading-[1.35] tracking-[-0.01em] break-words">
              {detail === null
                ? t("agents.approvals.loading")
                : titleForApproval(detail, cardTitle, t)}
            </h2>
          </div>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pt-3 pb-4">
        {error ? (
          <ApprovalDetailError onRetry={() => setRevision((v) => v + 1)} />
        ) : detail === null ? (
          <div className="space-y-3" aria-hidden="true">
            <Skeleton width={220} height={18} />
            <Skeleton width={140} height={12} />
            <Skeleton width="100%" height={80} />
          </div>
        ) : effectiveStatus === undefined || hint === null ? null : (
          <div>
            <div
              className={cn(
                "mb-2.5 flex items-start gap-2 rounded-[7px] border px-2.5 py-2 text-[11px] leading-[1.45]",
                toneClasses[hint.tone],
              )}
              data-testid="approval-status"
              data-status={effectiveStatus}
            >
              <span className="mt-px shrink-0">{hint.icon}</span>
              <span>{hint.text}</span>
            </div>

            <p className="text-[11.5px] leading-[1.55] text-foreground">
              <b className="font-semibold">{agentName}</b>{" "}
              {t("agents.approvals.asksPrefix")}{" "}
              <code className="font-mono text-[10.5px]">
                {detail.actionType}
              </code>{" "}
              {t("agents.approvals.asksOn")}{" "}
              <b className="font-semibold">{boardLabel}</b>.{" "}
              {t("agents.approvals.asksSuffix")}
            </p>

            {detail.kind === "destructive" ? (
              <div
                className="mt-2 rounded-r-[5px] border-l-2 border-danger bg-[color-mix(in_oklab,var(--danger)_6%,transparent)] px-2.5 py-2"
                data-testid="agents-approval-impact"
              >
                <p className="flex items-center gap-1.5 text-[11px] font-[650] text-foreground">
                  <AlertTriangle className="h-3 w-3 text-danger" aria-hidden />
                  {t("agents.approvals.destructiveTitle")}
                </p>
                <p className="mt-0.5 text-[10.5px] leading-[1.5] text-muted-foreground">
                  {t("agents.approvals.destructiveBody")}
                </p>
              </div>
            ) : null}

            <DetailSection title={t("agents.approvals.request")}>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                <RequestMeta label={t("agentControl.approvals.board")}>
                  {boardLabel}
                </RequestMeta>
                <RequestMeta label={t("agents.approvals.requestedBy")}>
                  {requestedBy}
                </RequestMeta>
                <RequestMeta label={t("agents.approvals.agent")}>
                  {session?.name === undefined &&
                  agentName === detail.requestedByTokenId ? (
                    <span className="font-mono text-[10px]">{agentName}</span>
                  ) : (
                    agentName
                  )}
                </RequestMeta>
                <RequestMeta label={t("agentControl.approvals.session")}>
                  {detail.agentSessionId === null ? (
                    t("agentControl.approvals.noSession")
                  ) : session?.name !== undefined ? (
                    session.name
                  ) : (
                    <span className="font-mono text-[10px]">
                      {detail.agentSessionId}
                    </span>
                  )}
                </RequestMeta>
                <RequestMeta label={t("agentControl.approvals.card")}>
                  {detail.cardId === null ? (
                    t("agentControl.approvals.noCard")
                  ) : (
                    <Link
                      to={`${routes.board(boardId)}?card=${encodeURIComponent(detail.cardId)}`}
                      className="hover:text-foreground hover:underline"
                      data-testid="agents-approval-card"
                    >
                      {cardTitle ?? detail.cardId}
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
                    : formatDate(detail.createdAt, lang)}
                </RequestMeta>
              </div>
            </DetailSection>

            <DetailSection
              title={t("agents.approvals.whatWillChange")}
              icon={<FileDiff aria-hidden />}
              aside={
                <Chip>
                  {t("agents.approvals.commands", { count: commandCount })}
                </Chip>
              }
            >
              <div className="grid grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)] items-center gap-1.5">
                <div className="min-w-0 rounded-md border border-border bg-background/35 px-2 py-1.5">
                  <span className="block text-[9.5px] tracking-[0.04em] text-muted-foreground uppercase">
                    {t("agents.approvals.knownTarget")}
                  </span>
                  <b className="mt-0.5 block text-[11px] leading-[1.4] font-semibold break-words">
                    {cardTitle ?? boardLabel}
                  </b>
                </div>
                <ArrowRight
                  className="h-3 w-3 justify-self-center text-muted-foreground"
                  aria-hidden
                />
                <div
                  className={cn(
                    "min-w-0 rounded-md border px-2 py-1.5",
                    detail.risk === "high" || detail.kind === "destructive"
                      ? "border-danger/30 bg-danger/5"
                      : detail.risk === "medium"
                        ? "border-warning/30 bg-warning/5"
                        : "border-border bg-background/35",
                  )}
                >
                  <span className="block text-[9.5px] tracking-[0.04em] text-muted-foreground uppercase">
                    {t("agents.approvals.exactAction")}
                  </span>
                  <b
                    className={cn(
                      "mt-0.5 block font-mono text-[11px] leading-[1.4] font-semibold break-all",
                      detail.risk === "high" || detail.kind === "destructive"
                        ? "text-danger"
                        : detail.risk === "medium"
                          ? "text-warning"
                          : "text-foreground",
                    )}
                  >
                    {detail.actionType}
                  </b>
                </div>
              </div>
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
                  className="min-w-0 flex-1 overflow-hidden font-mono text-[9.5px] whitespace-nowrap text-ellipsis text-muted-foreground"
                >
                  {detail.planHash.slice(0, 44)}…
                </code>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-[22px] w-[22px] shrink-0"
                  onClick={copyHash}
                  aria-label={t("agentControl.approvals.copyHash")}
                  data-testid="approval-copy-hash"
                >
                  {hashCopied ? (
                    <Check className="h-3 w-3 text-success" aria-hidden />
                  ) : (
                    <Copy className="h-3 w-3" aria-hidden />
                  )}
                </Button>
              </div>
              <p className="mt-1.5 text-[10.5px] leading-[1.5] text-muted-foreground">
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
                    time: formatDate(detail.createdAt, lang),
                    risk: t(APPROVAL_RISK_KEYS[detail.risk]),
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
                    detail={`${detail.decidedAt === null ? formatDate(detail.expiresAt, lang) : formatDate(detail.decidedAt, lang)}${
                      detail.decisionComment !== null
                        ? ` · “${detail.decisionComment}”`
                        : ""
                    }`}
                  />
                )}
                {detail.consumedAt !== null ? (
                  <HistoryItem
                    tone="primary"
                    title={t("agents.approvals.historyApplied")}
                    detail={formatDate(detail.consumedAt, lang)}
                  />
                ) : null}
              </div>
            </DetailSection>

            <DetailSection
              title={t("agents.approvals.related")}
              icon={<Link2 aria-hidden />}
            >
              <ApprovalLinks
                approval={detail}
                onCancelRequest={canDecide ? cancel : undefined}
                cancelBusy={busy}
              />
            </DetailSection>

            <details
              className="group mt-1.5 overflow-hidden rounded-md border border-border bg-background/30"
              data-testid="agents-approval-technical"
            >
              <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5 text-[10.5px] font-semibold text-muted-foreground [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  className="h-[11px] w-[11px] transition-transform group-open:rotate-90"
                  aria-hidden
                />
                {t("agents.approvals.technicalDetails")}
              </summary>
              <pre className="m-0 border-t border-border p-2 font-mono text-[9.5px] leading-[1.55] whitespace-pre-wrap break-words text-muted-foreground">
                {detail.plan === undefined
                  ? t("agentControl.approvals.noPlan")
                  : JSON.stringify(detail.plan ?? null, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
      {detail !== null && effectiveStatus !== undefined && hint !== null ? (
        <footer className="shrink-0 border-t border-border bg-[color-mix(in_oklab,var(--surface)_84%,var(--background))] px-3.5 py-2.5">
          {canDecide ? (
            <ApprovalDecisionForm
              key={`${detail.id}-${initialMode ?? "idle"}`}
              busy={busy}
              planHash={detail.planHash}
              initialMode={initialMode}
              onDecide={decide}
            />
          ) : (
            <>
              <p className="mb-2 flex items-start gap-1.5 text-[10.5px] leading-[1.45] text-muted-foreground">
                <span className="mt-px shrink-0">{hint.icon}</span>
                <span>{hint.text}</span>
              </p>
              {onBack !== undefined ? (
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 min-h-0 rounded-md px-2.5 text-[11px] font-[650]"
                    onClick={onBack}
                  >
                    {t("agents.approvals.closeDetail")}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </footer>
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
      <span className="mb-0.5 block text-[9.5px] tracking-[0.05em] text-muted-foreground uppercase">
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
    <span className="inline-flex h-5 items-center rounded border border-border bg-[color-mix(in_oklab,var(--surface)_65%,transparent)] px-1.5 text-[10.5px] font-semibold whitespace-nowrap text-muted-foreground">
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
    <div className="flex items-start gap-[7px] text-[10.5px] leading-[1.4]">
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
