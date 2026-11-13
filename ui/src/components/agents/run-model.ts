import {
  AGENT_RUN_KINDS,
  AGENT_RUN_STATUSES,
  type AgentRunKind,
  type AgentRunStatus,
  type Board,
  type BoardAction,
  type BoardRole,
  type RunSummaryDto,
} from "@janosik/shared";

import type { SelectOption } from "@/components/ui/select-field";
import type { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/i18n";

export type Translate = ReturnType<typeof useI18n>["t"];

export const RUN_STATUS_KEYS: Record<AgentRunStatus, MessageKey> = {
  applied: "agentControl.runs.status.applied",
  reverted: "agentControl.runs.status.reverted",
  failed: "agentControl.runs.status.failed",
};

export const RUN_KIND_KEYS: Record<AgentRunKind, MessageKey> = {
  batch: "agentControl.runs.kind.batch",
  plan: "agentControl.runs.kind.plan",
  single: "agentControl.runs.kind.single",
  revert: "agentControl.runs.kind.revert",
};

/**
 * TASK-179.5 run filters. The server runs endpoint takes the concrete values;
 * this module is the single URL/query contract shared by `/agents` and the
 * board-scoped Agent Control Runs tab. Unlike the session filter, run statuses
 * are the three stored lifecycles; `expired` is a rollback error, not a run
 * status, and is rendered beside the rollback preview.
 */

export type RunStatusFilter = "all" | AgentRunStatus;
export type RunKindFilter = "all" | AgentRunKind;
export type RunTimeFilter = "any" | "24h" | "7d" | "30d";

export interface AgentRunFilter {
  board: string;
  status: RunStatusFilter;
  kind: RunKindFilter;
  token: string;
  session: string;
  time: RunTimeFilter;
}

export const EMPTY_RUN_FILTER: AgentRunFilter = {
  board: "all",
  status: "all",
  kind: "all",
  token: "all",
  session: "all",
  time: "any",
};

export const RUN_STATUS_FILTERS: RunStatusFilter[] = [
  "all",
  ...AGENT_RUN_STATUSES,
];

export const RUN_KIND_FILTERS: RunKindFilter[] = ["all", ...AGENT_RUN_KINDS];

export const RUN_TIME_FILTERS: RunTimeFilter[] = ["any", "24h", "7d", "30d"];

export const RUN_TIME_WINDOWS_MS: Record<
  Exclude<RunTimeFilter, "any">,
  number
> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

/** How many rows one board page asks for. The API caps a page at 100. */
export const RUN_PAGE_SIZE = 50;

/** The `createdAt` lower bound for a time filter, or `undefined`. */
export function runFrom(
  filter: RunTimeFilter,
  now = Date.now(),
): number | undefined {
  if (filter === "any") return undefined;
  return now - RUN_TIME_WINDOWS_MS[filter];
}

/** The moment a run is ordered by: apply time, or creation for a failed run. */
export function runTime(
  run: Pick<RunSummaryDto, "appliedAt" | "createdAt">,
): number {
  return run.appliedAt || run.createdAt;
}

/**
 * Read the run filter from the `/agents` URL. `?agent=` is the token filter
 * (the old `?token=` alias is still accepted); `?session=` is the session
 * filter. Values from another section are ignored rather than rendered as a
 * broken label.
 */
export function readRunFilter(params: URLSearchParams): AgentRunFilter {
  const status = params.get("status");
  const kind = params.get("kind");
  const time = params.get("time");
  return {
    board: params.get("board") ?? "all",
    status:
      status !== null && (RUN_STATUS_FILTERS as string[]).includes(status)
        ? (status as RunStatusFilter)
        : "all",
    kind:
      kind !== null && (RUN_KIND_FILTERS as string[]).includes(kind)
        ? (kind as RunKindFilter)
        : "all",
    token: params.get("agent") ?? params.get("token") ?? "all",
    session: params.get("session") ?? "all",
    time:
      time !== null && (RUN_TIME_FILTERS as string[]).includes(time)
        ? (time as RunTimeFilter)
        : "any",
  };
}

/** Write a run filter back to the URL, removing defaults and aliases. */
export function writeRunFilter(
  params: URLSearchParams,
  filter: AgentRunFilter,
): void {
  setOrDelete(params, "board", filter.board, "all");
  params.delete("token");
  setOrDelete(params, "agent", filter.token, "all");
  setOrDelete(params, "status", filter.status, "all");
  setOrDelete(params, "kind", filter.kind, "all");
  setOrDelete(params, "time", filter.time, "any");
  setOrDelete(params, "session", filter.session, "all");
}

/** True when anything narrows the list besides the board scope. */
export function hasRunFilter(filter: AgentRunFilter): boolean {
  return (
    filter.token !== "all" ||
    filter.session !== "all" ||
    filter.status !== "all" ||
    filter.kind !== "all" ||
    filter.time !== "any"
  );
}

/** Build the canonical deep link; `?run=` is never emitted without `?board=`. */
export function runLink(boardId: string, runId: string): string {
  const params = new URLSearchParams({
    section: "runs",
    board: boardId,
    run: runId,
  });
  return `/agents?${params.toString()}`;
}

/** A stable local-day key for grouping the history by day. */
export function runDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

export interface RunDayGroup<Row> {
  key: string;
  timestamp: number;
  rows: Row[];
}

/** Group rows into calendar days, newest day first. */
export function groupRunsByDay<
  Row extends Pick<RunSummaryDto, "createdAt" | "appliedAt">,
>(rows: readonly Row[]): RunDayGroup<Row>[] {
  const groups = new Map<string, RunDayGroup<Row>>();
  for (const row of rows) {
    const at = runTime(row);
    const key = runDayKey(at);
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, { key, timestamp: at, rows: [row] });
    } else {
      existing.rows.push(row);
      existing.timestamp = Math.max(existing.timestamp, at);
    }
  }
  return [...groups.values()].sort((a, b) => b.timestamp - a.timestamp);
}

export interface RunBoardScope {
  id: string;
  title: string;
  role: BoardRole;
}

/** Board role for a run scope; an unknown board is treated as read-only. */
export function runBoardRole(
  boards: readonly RunBoardScope[],
  boardId: string,
): BoardRole | undefined {
  return boards.find((board) => board.id === boardId)?.role;
}

/** The list title used where the API has no stored human summary. */
export function runTitle(run: RunSummaryDto, t: Translate): string {
  return t("agents.runs.rowTitle", {
    kind: t(RUN_KIND_KEYS[run.kind]),
    count: run.commandCount,
  });
}

/** The shared filter option lists. Board scope is rendered by each surface. */
export function runFilterOptions(t: Translate): {
  status: SelectOption<RunStatusFilter>[];
  kind: SelectOption<RunKindFilter>[];
  time: SelectOption<RunTimeFilter>[];
} {
  return {
    status: [
      { value: "all", label: t("agents.runs.filters.allStatuses") },
      ...(["applied", "reverted", "failed"] as const).map((value) => ({
        value,
        label: t(RUN_STATUS_KEYS[value]),
      })),
    ],
    kind: [
      { value: "all", label: t("agents.runs.filters.allKinds") },
      ...(["batch", "plan", "single", "revert"] as const).map((value) => ({
        value,
        label: t(RUN_KIND_KEYS[value]),
      })),
    ],
    time: [
      { value: "any", label: t("agents.runs.filters.anyTime") },
      { value: "24h", label: t("agentControl.runs.filter.last24h") },
      { value: "7d", label: t("agentControl.runs.filter.last7d") },
      { value: "30d", label: t("agentControl.runs.filter.last30d") },
    ],
  };
}

export function entityIdOf(
  action: BoardAction,
): { field: string; id: string } | null {
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

/** A short human target for a command row. */
export function actionSummary(
  action: BoardAction,
  board: Board | undefined,
): string {
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

function setOrDelete(
  params: URLSearchParams,
  key: string,
  value: string,
  empty: string,
): void {
  if (value === empty) params.delete(key);
  else params.set(key, value);
}
