import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Clock,
  FileClock,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import type {
  AgentRunKind,
  AgentRunStatus,
  Board,
  BoardAction,
  RunDetailDto,
  RunSummaryDto,
  RevertPreviewDto,
} from "@janosik/shared";
import { AGENT_RUN_KINDS, AGENT_RUN_STATUSES } from "@janosik/shared";

import { api, ApiError, isApiEnabled } from "@/api/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SelectField } from "@/components/ui/select-field";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { useToast } from "@/components/Toast";
import { formatDate, formatRelative, useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/i18n";
import { useBoardLive } from "@/store/board-live";
import { useBoardState } from "@/store/BoardContext";
import { createId } from "@/utils/id";

type Role = "ADMIN" | "MEMBER" | "VIEWER" | undefined;
type StatusFilter = "all" | AgentRunStatus;
type KindFilter = "all" | AgentRunKind;
type TimeRange = "all" | "24h" | "7d" | "30d";
type Translate = ReturnType<typeof useI18n>["t"];

const STATUS_KEYS: Record<AgentRunStatus, MessageKey> = {
  applied: "agentControl.runs.status.applied",
  reverted: "agentControl.runs.status.reverted",
  failed: "agentControl.runs.status.failed",
};

const KIND_KEYS: Record<AgentRunKind, MessageKey> = {
  batch: "agentControl.runs.kind.batch",
  plan: "agentControl.runs.kind.plan",
  single: "agentControl.runs.kind.single",
  revert: "agentControl.runs.kind.revert",
};

const STATUS_CLASS: Record<AgentRunStatus, string> = {
  applied: "border-success/40 bg-success/10 text-success",
  reverted: "border-primary/40 bg-primary/10 text-primary",
  failed: "border-danger/40 bg-danger/10 text-danger",
};

const RANGE_MS: Record<Exclude<TimeRange, "all">, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

function errorCodeOf(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const body = error.body;
  if (body === null || typeof body !== "object") return undefined;
  const code = (body as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function conflictCount(error: unknown): number | null {
  if (!(error instanceof ApiError)) return null;
  const body = error.body;
  if (body === null || typeof body !== "object") return null;
  const details = (body as { details?: unknown }).details;
  if (details === null || typeof details !== "object") return null;
  const conflicts = (details as { conflicts?: unknown }).conflicts;
  return Array.isArray(conflicts) ? conflicts.length : null;
}

function runError(error: unknown, t: Translate): string {
  if (error instanceof ApiError && error.offline) {
    return t("agentControl.error.offline");
  }
  switch (errorCodeOf(error)) {
    case "pat_forbidden":
      return t("agentControl.runs.error.patForbidden");
    case "run_conflict": {
      const count = conflictCount(error);
      return count === null
        ? t("agentControl.runs.error.conflict")
        : t("agentControl.runs.error.conflictCount", { count });
    }
    case "run_expired":
      return t("agentControl.runs.error.expired");
    case "scope_denied":
      return t("agentControl.runs.error.adminOnly");
    default:
      break;
  }
  if (error instanceof ApiError && error.status === 403) {
    return t("agentControl.error.forbidden");
  }
  return t("agentControl.error.generic");
}

function entityIdOf(action: BoardAction): {
  field: string;
  id: string;
} | null {
  const record = action as unknown as Record<string, unknown>;
  const fields = [
    "cardId",
    "newCardId",
    "columnId",
    "newColumnId",
    "labelId",
    "newLabelId",
    "checklistId",
    "newChecklistId",
    "itemId",
    "newItemId",
  ];
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string" && value !== "") return { field, id: value };
  }
  return null;
}

/** A short human sentence for a run command row. */
function actionSummary(action: BoardAction, board: Board | undefined): string {
  const entity = entityIdOf(action);
  if (entity === null) {
    const title = (action as unknown as { title?: unknown }).title;
    return typeof title === "string" ? title : "";
  }
  if (entity.field.toLowerCase().includes("card")) {
    return board?.cards[entity.id]?.title ?? entity.id;
  }
  if (entity.field.toLowerCase().includes("column")) {
    return (
      board?.columns.find((column) => column.id === entity.id)?.title ??
      entity.id
    );
  }
  if (entity.field.toLowerCase().includes("label")) {
    return (
      board?.labels.find((label) => label.id === entity.id)?.name ?? entity.id
    );
  }
  return entity.id;
}

function runTime(run: RunSummaryDto): number {
  return run.appliedAt || run.createdAt;
}

export function RunsPanel({ role }: { role: Role }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { board } = useBoardState();
  const live = useBoardLive();
  const boardId = board?.id;
  const admin = role === "ADMIN";

  const [status, setStatus] = useState<StatusFilter>("all");
  const [kind, setKind] = useState<KindFilter>("all");
  const [range, setRange] = useState<TimeRange>("all");
  const [tokenInput, setTokenInput] = useState("");
  const [sessionInput, setSessionInput] = useState("");
  const [tokenFilter, setTokenFilter] = useState("");
  const [sessionFilter, setSessionFilter] = useState("");
  const [runs, setRuns] = useState<RunSummaryDto[] | null>(null);
  const [listError, setListError] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetailDto | null>(null);
  const [detailError, setDetailError] = useState(false);
  const [preview, setPreview] = useState<RevertPreviewDto | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reverting, setReverting] = useState(false);

  // Debounce the free-text token/session filters so typing does not fire one
  // request (and one skeleton) per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setTokenFilter(tokenInput.trim());
      setSessionFilter(sessionInput.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [tokenInput, sessionInput]);

  // A committed human rollback arrives as `run.reverted`; the list and the
  // open detail refetch without a reload.
  useEffect(
    () => live.agentControl.subscribeRun(() => setRevision((v) => v + 1)),
    [live],
  );

  const query = useCallback(
    (nextCursor?: string) => {
      const from = range === "all" ? undefined : Date.now() - RANGE_MS[range];
      return {
        ...(status === "all" ? {} : { status }),
        ...(kind === "all" ? {} : { kind }),
        ...(tokenFilter === "" ? {} : { apiTokenId: tokenFilter }),
        ...(sessionFilter === "" ? {} : { agentSessionId: sessionFilter }),
        ...(from === undefined ? {} : { from }),
        limit: 50,
        ...(nextCursor === undefined ? {} : { cursor: nextCursor }),
      };
    },
    [status, kind, range, tokenFilter, sessionFilter],
  );

  useEffect(() => {
    if (boardId === undefined || !isApiEnabled()) return;
    let alive = true;
    setListError(false);
    setRuns(null);
    setCursor(null);
    void api
      .listRuns(boardId, query())
      .then((rows) => {
        if (!alive) return;
        setRuns(rows);
        setSelectedId((current) =>
          current !== null && rows.some((row) => row.id === current)
            ? current
            : (rows[0]?.id ?? null),
        );
      })
      .catch(() => {
        if (!alive) return;
        setListError(true);
        setRuns([]);
      });
    return () => {
      alive = false;
    };
  }, [boardId, query, revision]);

  useEffect(() => {
    if (boardId === undefined || selectedId === null || !isApiEnabled()) {
      setDetail(null);
      return;
    }
    let alive = true;
    setDetail(null);
    setDetailError(false);
    setPreview(null);
    setPreviewError(null);
    setActionError(null);
    void (async () => {
      try {
        const loaded = await api.getRun(boardId, selectedId);
        if (!alive) return;
        setDetail(loaded);
        if (loaded.run.status === "applied" && loaded.run.kind !== "revert") {
          await loadPreview(boardId, selectedId, alive);
        }
      } catch {
        if (alive) setDetailError(true);
      }
    })();
    return () => {
      alive = false;
    };
    // `loadPreview` is stable for one board/run pair; the effect is the
    // single place that seeds both panes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, selectedId, revision]);

  async function loadPreview(
    targetBoard: string,
    runId: string,
    alive = true,
  ): Promise<void> {
    setPreviewing(true);
    setPreviewError(null);
    try {
      const result = await api.previewRunRevert(targetBoard, runId);
      if (alive) setPreview(result);
    } catch (error) {
      if (alive) setPreviewError(runError(error, t));
    } finally {
      if (alive) setPreviewing(false);
    }
  }

  const loadMore = async () => {
    if (boardId === undefined || cursor === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const rows = await api.listRuns(boardId, query(cursor));
      setRuns((current) => [...(current ?? []), ...rows]);
      setCursor(rows.length === 50 ? rows[rows.length - 1].id : null);
    } catch {
      setListError(true);
    } finally {
      setLoadingMore(false);
    }
  };

  // The list response does not say whether more rows exist; a full page is a
  // good enough cursor until the next request returns a short page.
  useEffect(() => {
    if (runs !== null && runs.length > 0) {
      setCursor((current) =>
        current === null && runs.length === 50
          ? runs[runs.length - 1].id
          : current,
      );
    }
  }, [runs]);

  const revert = async () => {
    if (boardId === undefined || selectedId === null || reverting) return;
    setReverting(true);
    setActionError(null);
    try {
      await api.revertRun(boardId, selectedId, {
        dryRun: false,
        commandId: createId(),
      });
      toast.success(t("agentControl.runs.revertedToast"));
      setConfirmOpen(false);
      setPreview(null);
      setRevision((value) => value + 1);
    } catch (error) {
      setActionError(runError(error, t));
      setConfirmOpen(false);
    } finally {
      setReverting(false);
    }
  };

  const statusOptions = useMemo(
    () => [
      { value: "all" as const, label: t("agentControl.runs.filter.all") },
      ...AGENT_RUN_STATUSES.map((value) => ({
        value,
        label: t(STATUS_KEYS[value]),
      })),
    ],
    [t],
  );
  const kindOptions = useMemo(
    () => [
      { value: "all" as const, label: t("agentControl.runs.filter.all") },
      ...AGENT_RUN_KINDS.map((value) => ({
        value,
        label: t(KIND_KEYS[value]),
      })),
    ],
    [t],
  );
  const rangeOptions = useMemo(
    () => [
      { value: "all" as const, label: t("agentControl.runs.filter.anyTime") },
      { value: "24h" as const, label: t("agentControl.runs.filter.last24h") },
      { value: "7d" as const, label: t("agentControl.runs.filter.last7d") },
      { value: "30d" as const, label: t("agentControl.runs.filter.last30d") },
    ],
    [t],
  );

  if (!isApiEnabled()) {
    return (
      <p className="p-4 text-xs text-muted-foreground">
        {t("agentControl.runs.offline")}
      </p>
    );
  }

  const conflicts = preview?.conflicts ?? [];

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-testid="agent-runs-panel"
    >
      <div className="flex shrink-0 flex-wrap items-end gap-2 border-b px-4 py-2">
        <label className="min-w-28 flex-1 space-y-1 text-[11px] text-muted-foreground">
          <span>{t("agentControl.runs.filter.status")}</span>
          <SelectField
            value={status}
            options={statusOptions}
            onChange={setStatus}
            ariaLabel={t("agentControl.runs.filter.status")}
            testId="run-filter-status"
          />
        </label>
        <label className="min-w-28 flex-1 space-y-1 text-[11px] text-muted-foreground">
          <span>{t("agentControl.runs.filter.kind")}</span>
          <SelectField
            value={kind}
            options={kindOptions}
            onChange={setKind}
            ariaLabel={t("agentControl.runs.filter.kind")}
            testId="run-filter-kind"
          />
        </label>
        <label className="min-w-28 flex-1 space-y-1 text-[11px] text-muted-foreground">
          <span>{t("agentControl.runs.filter.time")}</span>
          <SelectField
            value={range}
            options={rangeOptions}
            onChange={setRange}
            ariaLabel={t("agentControl.runs.filter.time")}
            testId="run-filter-time"
          />
        </label>
        <label className="min-w-32 flex-1 space-y-1 text-[11px] text-muted-foreground">
          <span>{t("agentControl.runs.filter.token")}</span>
          <input
            data-testid="run-filter-token"
            value={tokenInput}
            onChange={(event) => setTokenInput(event.target.value)}
            placeholder={t("agentControl.runs.filter.tokenPlaceholder")}
            className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring"
          />
        </label>
        <label className="min-w-32 flex-1 space-y-1 text-[11px] text-muted-foreground">
          <span>{t("agentControl.runs.filter.session")}</span>
          <input
            data-testid="run-filter-session"
            value={sessionInput}
            onChange={(event) => setSessionInput(event.target.value)}
            placeholder={t("agentControl.runs.filter.sessionPlaceholder")}
            className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring"
          />
        </label>
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(10rem,40%)_1fr] md:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)] md:grid-rows-1">
        <div className="min-h-0 overflow-y-auto border-b md:border-b-0 md:border-r">
          {listError ? (
            <div className="space-y-2 p-4">
              <p className="text-xs text-danger">
                {t("agentControl.runs.loadError")}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRevision((value) => value + 1)}
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                {t("agentControl.retry")}
              </Button>
            </div>
          ) : runs === null ? (
            <SkeletonRegion
              label={t("agentControl.runs.loading")}
              testId="agent-runs-skeleton"
            >
              <div className="space-y-2 p-3" aria-hidden="true">
                {Array.from({ length: 4 }, (_, index) => (
                  <div
                    key={index}
                    className="space-y-1.5 rounded-lg border p-2"
                  >
                    <Skeleton width={120} height={12} />
                    <Skeleton width={180} height={10} />
                  </div>
                ))}
              </div>
            </SkeletonRegion>
          ) : runs.length === 0 ? (
            <div
              className="flex flex-col items-center gap-2 p-6 text-center"
              data-testid="agent-runs-empty"
            >
              <FileClock
                className="h-6 w-6 text-muted-foreground/60"
                aria-hidden
              />
              <p className="text-xs text-muted-foreground">
                {t("agentControl.runs.empty")}
              </p>
            </div>
          ) : (
            <ul className="divide-y" data-testid="agent-run-list">
              {runs.map((run) => (
                <li key={run.id}>
                  <button
                    type="button"
                    data-testid={`agent-run-row-${run.id}`}
                    data-status={run.status}
                    aria-current={selectedId === run.id}
                    onClick={() => setSelectedId(run.id)}
                    className={
                      selectedId === run.id
                        ? "w-full space-y-1 bg-primary/10 px-3 py-2 text-left"
                        : "w-full space-y-1 px-3 py-2 text-left hover:bg-hover"
                    }
                  >
                    <span className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {run.id.slice(0, 10)}…
                      </span>
                      <span
                        className={`rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${STATUS_CLASS[run.status]}`}
                      >
                        {t(STATUS_KEYS[run.status])}
                      </span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {t(KIND_KEYS[run.kind])}
                      </span>
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {t("agentControl.runs.rowMeta", {
                        commands: run.commandCount,
                        time: formatRelative(runTime(run), lang),
                      })}
                    </span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {run.apiTokenId ?? t("agentControl.runs.noToken")} ·{" "}
                      {run.agentSessionId ?? t("agentControl.runs.noSession")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {cursor !== null && runs !== null && runs.length > 0 ? (
            <div className="p-3">
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                disabled={loadingMore}
                data-testid="agent-runs-more"
                onClick={() => void loadMore()}
              >
                {loadingMore ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                )}
                {t("agentControl.runs.loadMore")}
              </Button>
            </div>
          ) : null}
        </div>

        <div className="min-h-0 overflow-y-auto">
          {selectedId === null ? (
            <p className="p-4 text-xs text-muted-foreground">
              {t("agentControl.runs.selectHint")}
            </p>
          ) : detailError ? (
            <p className="p-4 text-xs text-danger">
              {t("agentControl.runs.detailError")}
            </p>
          ) : detail === null ? (
            <SkeletonRegion
              label={t("agentControl.runs.detailLoading")}
              testId="agent-run-detail-skeleton"
            >
              <div className="space-y-2 p-4" aria-hidden="true">
                <Skeleton width={200} height={14} />
                <Skeleton width={280} height={10} />
                <Skeleton width={240} height={10} />
              </div>
            </SkeletonRegion>
          ) : (
            <div className="space-y-4 p-4" data-testid="agent-run-detail">
              <header className="space-y-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  <Bot className="h-4 w-4 text-primary" aria-hidden />
                  <span className="font-mono text-xs">{detail.run.id}</span>
                  <span
                    data-testid="agent-run-status"
                    data-status={detail.run.status}
                    className={`rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${STATUS_CLASS[detail.run.status]}`}
                  >
                    {t(STATUS_KEYS[detail.run.status])}
                  </span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {t(KIND_KEYS[detail.run.kind])}
                  </span>
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {t("agentControl.runs.detailMeta", {
                    commands: detail.run.commandCount,
                    first: detail.run.firstSeq ?? "—",
                    last: detail.run.lastSeq ?? "—",
                  })}
                </p>
              </header>

              <section className="space-y-1.5" data-testid="agent-run-timeline">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold">
                  <Clock className="h-3.5 w-3.5 text-primary" aria-hidden />
                  {t("agentControl.runs.timeline")}
                </h4>
                <ul className="space-y-1 text-[11px] text-muted-foreground">
                  <li>
                    {t("agentControl.runs.created")}:{" "}
                    {formatDate(detail.run.createdAt, lang, true)}
                  </li>
                  <li>
                    {t("agentControl.runs.applied")}:{" "}
                    {formatDate(detail.run.appliedAt, lang, true)}
                  </li>
                  {detail.run.revertedAt !== null ? (
                    <li data-testid="agent-run-reverted-at">
                      {t("agentControl.runs.reverted")}:{" "}
                      {formatDate(detail.run.revertedAt, lang, true)}
                    </li>
                  ) : null}
                  {detail.run.revertsRunId !== null ? (
                    <li>
                      {t("agentControl.runs.revertsRun")}:{" "}
                      <span className="font-mono">
                        {detail.run.revertsRunId}
                      </span>
                    </li>
                  ) : null}
                </ul>
              </section>

              <section className="grid gap-2 text-[11px] sm:grid-cols-2">
                <div className="rounded-md border p-2">
                  <p className="text-muted-foreground">
                    {t("agentControl.runs.attribution")}
                  </p>
                  <p className="font-mono break-all">{detail.run.actorId}</p>
                  <p className="font-mono break-all text-muted-foreground">
                    {t("agentControl.runs.token")}:{" "}
                    {detail.run.apiTokenId ?? "—"}
                  </p>
                  <p className="font-mono break-all text-muted-foreground">
                    {t("agentControl.runs.session")}:{" "}
                    {detail.run.agentSessionId ?? "—"}
                  </p>
                </div>
                <div className="rounded-md border p-2">
                  <p className="text-muted-foreground">
                    {t("agentControl.runs.authorization")}
                  </p>
                  <p className="font-mono break-all">
                    {t("agentControl.runs.planHash")}:{" "}
                    {detail.run.planHash ?? "—"}
                  </p>
                  <p className="font-mono break-all text-muted-foreground">
                    {t("agentControl.runs.approval")}:{" "}
                    {detail.run.approvalId ?? "—"}
                  </p>
                  <p className="font-mono break-all text-muted-foreground">
                    {t("agentControl.runs.clientRunId")}:{" "}
                    {detail.run.clientRunId ?? "—"}
                  </p>
                </div>
              </section>

              {actionError !== null ? (
                <p
                  role="alert"
                  data-testid="agent-run-action-error"
                  className="rounded-md border border-danger/40 bg-danger/10 p-2 text-xs text-danger"
                >
                  {actionError}
                </p>
              ) : null}

              <section className="space-y-2" data-testid="agent-run-commands">
                <h4 className="text-xs font-semibold">
                  {t("agentControl.runs.commands", {
                    count: detail.commands.length,
                  })}
                </h4>
                {detail.commands.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    {t("agentControl.runs.noCommands")}
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {detail.commands.map((command) => {
                      const preimage =
                        detail.preimages[command.commandId ?? ""];
                      return (
                        <li
                          key={command.seq}
                          data-testid={`agent-run-command-${command.seq}`}
                          className="space-y-1 rounded-md border p-2 text-[11px]"
                        >
                          <p className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono text-muted-foreground">
                              #{command.seq}
                            </span>
                            <code className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                              {command.action.type}
                            </code>
                            <span className="truncate text-muted-foreground">
                              {actionSummary(command.action, board)}
                            </span>
                          </p>
                          <p className="truncate text-[10px] text-muted-foreground">
                            {command.actorType === "agent"
                              ? t("agentControl.runs.actorAgent")
                              : t("agentControl.runs.actorHuman")}{" "}
                            · {command.agentName ?? command.actorId}
                            {command.apiTokenId !== undefined
                              ? ` · ${t("agentControl.runs.token")} ${command.apiTokenId}`
                              : ""}
                            {command.agentSessionId !== undefined
                              ? ` · ${t("agentControl.runs.session")} ${command.agentSessionId}`
                              : ""}
                          </p>
                          {preimage !== undefined ? (
                            <details data-testid="agent-run-preimage">
                              <summary className="cursor-pointer text-[10px] text-muted-foreground">
                                {t("agentControl.runs.preimage")}
                              </summary>
                              <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted/50 p-1.5 text-[10px]">
                                {JSON.stringify(preimage, null, 2)}
                              </pre>
                            </details>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section
                className="space-y-2 rounded-md border p-2"
                data-testid="agent-run-revert"
              >
                <h4 className="flex items-center gap-1.5 text-xs font-semibold">
                  <RotateCcw className="h-3.5 w-3.5 text-primary" aria-hidden />
                  {t("agentControl.runs.rollback")}
                </h4>
                <p className="text-[11px] text-muted-foreground">
                  {t("agentControl.runs.rollbackHint")}
                </p>
                {previewing ? (
                  <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    {t("agentControl.runs.previewing")}
                  </p>
                ) : previewError !== null ? (
                  <p className="text-[11px] text-danger" role="alert">
                    {previewError}
                  </p>
                ) : preview !== null ? (
                  <div className="space-y-2 text-[11px]">
                    <p
                      data-testid="agent-run-can-revert"
                      data-can-revert={preview.canRevert ? "true" : "false"}
                      className={
                        preview.canRevert ? "text-success" : "text-warning"
                      }
                    >
                      {preview.canRevert
                        ? t("agentControl.runs.canRevert")
                        : t("agentControl.runs.cannotRevert")}
                    </p>
                    {conflicts.length > 0 ? (
                      <ul
                        data-testid="agent-run-conflicts"
                        className="space-y-1"
                      >
                        {conflicts.map((conflict) => (
                          <li
                            key={conflict.touch}
                            className="rounded border border-warning/40 bg-warning/10 p-1.5 text-warning"
                          >
                            <span className="font-mono">{conflict.touch}</span>{" "}
                            · {conflict.reason} · {conflict.expectedVersion} →{" "}
                            {conflict.currentVersion}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {preview.diff !== undefined ? (
                      <details data-testid="agent-run-diff">
                        <summary className="cursor-pointer text-muted-foreground">
                          {t("agentControl.runs.diff")}
                        </summary>
                        <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted/50 p-1.5 text-[10px]">
                          {JSON.stringify(preview.diff, null, 2)}
                        </pre>
                      </details>
                    ) : null}
                    {detail.run.status === "applied" &&
                    detail.run.kind !== "revert" ? (
                      admin ? (
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid="agent-run-revert-apply"
                          disabled={!preview.canRevert || reverting}
                          onClick={() => setConfirmOpen(true)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                          {t("agentControl.runs.revert")}
                        </Button>
                      ) : (
                        <p className="text-muted-foreground">
                          {t("agentControl.runs.adminOnly")}
                        </p>
                      )
                    ) : null}
                  </div>
                ) : null}
                {detail.run.status === "reverted" ? (
                  <p
                    data-testid="agent-run-already-reverted"
                    className="text-[11px] text-muted-foreground"
                  >
                    {t("agentControl.runs.alreadyReverted")}
                  </p>
                ) : null}
                {detail.run.status === "applied" &&
                detail.run.kind !== "revert" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    data-testid="agent-run-preview"
                    disabled={previewing}
                    onClick={() =>
                      void loadPreview(detail.run.boardId, detail.run.id)
                    }
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                    {t("agentControl.runs.refreshPreview")}
                  </Button>
                ) : null}
              </section>

              {Object.keys(detail.preimages).length > 0 ? (
                <section
                  className="space-y-1"
                  data-testid="agent-run-preimages"
                >
                  <h4 className="flex items-center gap-1.5 text-xs font-semibold">
                    <ShieldCheck
                      className="h-3.5 w-3.5 text-primary"
                      aria-hidden
                    />
                    {t("agentControl.runs.preimagesTitle")}
                  </h4>
                  <p className="text-[11px] text-muted-foreground">
                    {t("agentControl.runs.preimagesHint")}
                  </p>
                  <pre className="max-h-64 overflow-auto rounded bg-muted/50 p-1.5 text-[10px]">
                    {JSON.stringify(detail.preimages, null, 2)}
                  </pre>
                </section>
              ) : null}

              {detail.run.kind === "revert" ? (
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                  {t("agentControl.runs.revertRunHint")}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md" data-testid="run-revert-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-4 w-4 text-warning" aria-hidden />
              {t("agentControl.runs.confirmTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("agentControl.runs.confirmDescription", {
                id: selectedId ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            {t("agentControl.runs.confirmSemantics")}
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={reverting}
              onClick={() => setConfirmOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              data-testid="run-revert-confirm"
              disabled={reverting}
              onClick={() => void revert()}
            >
              {reverting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              )}
              {t("agentControl.runs.revert")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
