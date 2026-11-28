import type { CardPriority } from "@janosik/shared";
import { CARD_PRIORITIES, LIMITS } from "@janosik/shared";
import {
  createdDayRange,
  isFilterActive,
  type CardFilter,
  type CreatedWindow,
  type DueFilter,
  type LabelMatch,
} from "@/utils/filter";
import {
  listQuarantineKeys,
  quarantineValue,
  readJSON,
  readRaw,
  saveJSON,
} from "@/utils/storage";

/**
 * Local-only saved board views (TASK-177.20.2).
 *
 * A saved view is a name + a `CardFilter` + the optional projection. It is
 * stored per account and per board in localStorage; nothing is sent to the
 * server, so views do not sync across browsers or devices. The URL remains
 * the shareable form of a view.
 *
 * Reads are defensive: the payload is versioned, every filter field is
 * whitelisted, unknown/invalid fields fall back to their neutral value,
 * empty filters are dropped, and unreadable JSON (or a payload of the wrong
 * shape) is quarantined through the shared storage helpers instead of being
 * overwritten silently. A newer payload version is reported as
 * `unsupported` so an older build cannot clobber it.
 */

/** Payload schema version. Bump only together with a reader migration. */
export const SAVED_VIEWS_VERSION = 2;
/** Saved views kept per account + board. */
export const MAX_SAVED_VIEWS = 20;
/** Maximum saved-view name, in UTF-16 characters (matches the input cap). */
export const SAVED_VIEW_NAME_LIMIT = 60;

const STORAGE_PREFIX = "janosik-saved-views";
/** Guardrail against hand-edited payloads; real boards stay far below it. */
const MAX_FILTER_IDS = 200;
const SAVABLE_VIEWS = ["board", "calendar", "table"] as const;

/** Projections a saved view may restore. "watch" is deliberately excluded. */
export type SavedViewProjection = (typeof SAVABLE_VIEWS)[number];

export interface SavedView {
  name: string;
  filter: CardFilter;
  view?: SavedViewProjection;
}

/** Why a create/rename was rejected. Empty filters are not saveable. */
export type SavedViewError =
  "empty-filter" | "invalid-name" | "duplicate" | "limit" | "not-found";

export type SavedViewMutation =
  | { ok: true; views: SavedView[]; view: SavedView }
  | { ok: false; reason: SavedViewError };

export type SavedViewsLoadStatus =
  | "ok"
  | "missing"
  | "corrupt"
  | "unavailable"
  /** A newer payload version wrote this key; leave it untouched. */
  | "unsupported";

export interface SavedViewsLoadResult {
  status: SavedViewsLoadStatus;
  views: SavedView[];
  /** The key held an older payload; the next write upgrades it. */
  migrated?: boolean;
  /** Where unparsable/wrong-shape text was copied, when that succeeded. */
  quarantineKey?: string | null;
}

export interface SavedViewsOptions {
  /** Labels currently present on the board. Undefined means "not loaded". */
  labelIds?: readonly string[];
  /** Board member ids currently present. Undefined means "not loaded". */
  assigneeIds?: readonly string[];
  epicIds?: readonly string[];
}

export interface PrunedSavedViews {
  views: SavedView[];
  /** A view referenced a label/assignee id that is no longer on the board. */
  missingOptions: boolean;
  /** Views still active, but with missing options removed from their filter. */
  changedViewNames: string[];
  /** Views whose last facet disappeared; they are no longer usable and are dropped. */
  droppedViewNames: string[];
}

/** Why a write was refused; the UI maps these to truthful status copy. */
export type SavedViewsWriteError =
  | "storage"
  /** Another tab/app version wrote a newer payload; never overwrite it. */
  | "newer-version"
  /** Damaged data could not be quarantined, so writing would destroy it. */
  | "corrupt";

export type SaveSavedViewsResult =
  | { ok: true; views: SavedView[] }
  | { ok: false; reason: SavedViewsWriteError };

/** Storage key: one namespace per account *and* board. */
export function savedViewsKey(userId: string, boardId: string): string {
  return `${STORAGE_PREFIX}:${encodeURIComponent(userId)}:${encodeURIComponent(boardId)}`;
}

export function isSavedViewProjection(
  value: unknown,
): value is SavedViewProjection {
  return SAVABLE_VIEWS.includes(value as SavedViewProjection);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<string>();
  for (const item of value) {
    if (out.size >= MAX_FILTER_IDS) break;
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (id !== "") out.add(id);
  }
  return [...out];
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/**
 * Whitelist a stored filter. Every field is rebuilt from known keys, so a
 * hand-edited payload can never smuggle extra state into the board. Returns
 * null for an empty/invalid filter — callers do not save those.
 */
export function sanitizeSavedViewFilter(value: unknown): CardFilter | null {
  const raw = asRecord(value);
  if (raw === null) return null;

  const priorities = uniqueStrings(raw.priorities).filter(
    (entry): entry is CardPriority =>
      CARD_PRIORITIES.includes(entry as CardPriority),
  );
  const createdOn =
    typeof raw.createdOn === "string" && createdDayRange(raw.createdOn) !== null
      ? raw.createdOn
      : null;
  const filter: CardFilter = {
    query:
      typeof raw.query === "string" ? raw.query.slice(0, LIMITS.query) : "",
    labelIds: uniqueStrings(raw.labelIds),
    labelMatch: enumValue<LabelMatch>(raw.labelMatch, ["any", "all"], "any"),
    noLabel: raw.noLabel === true,
    created: enumValue<CreatedWindow>(
      raw.created,
      ["today", "7d", "30d"],
      "any",
    ),
    createdOn,
    due: enumValue<DueFilter>(raw.due, ["overdue", "soon", "none"], "any"),
    priorities,
    assignees: uniqueStrings(raw.assignees),
    unassigned: raw.unassigned === true,
    blocked: raw.blocked === true,
    hasLinks: raw.hasLinks === true,
    epicIds: uniqueStrings(raw.epicIds),
    hasEpic: raw.hasEpic === true,
    noEpic: raw.noEpic === true,
  };
  return isFilterActive(filter) ? filter : null;
}

function sanitizeSavedViewName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().slice(0, SAVED_VIEW_NAME_LIMIT);
  return name === "" ? null : name;
}

function sanitizeSavedView(value: unknown): SavedView | null {
  const raw = asRecord(value);
  if (raw === null) return null;
  const name = sanitizeSavedViewName(raw.name);
  if (name === null) return null;
  const filter = sanitizeSavedViewFilter(raw.filter);
  if (filter === null) return null;
  return {
    name,
    filter,
    ...(isSavedViewProjection(raw.view) ? { view: raw.view } : {}),
  };
}

/**
 * Sanitize a stored list: drop invalid entries and empty filters, enforce the
 * per-board cap, and keep the first of case-insensitively duplicate names.
 */
export function sanitizeSavedViews(value: readonly unknown[]): SavedView[] {
  const views: SavedView[] = [];
  const names = new Set<string>();
  for (const entry of value) {
    if (views.length >= MAX_SAVED_VIEWS) break;
    const view = sanitizeSavedView(entry);
    if (view === null) continue;
    const key = view.name.toLowerCase();
    if (names.has(key)) continue;
    names.add(key);
    views.push(view);
  }
  return views;
}

type ParsedPayload =
  | { kind: "views"; views: unknown[]; migrated: boolean }
  | { kind: "unsupported" }
  | { kind: "invalid" };

function parsePayload(value: unknown): ParsedPayload {
  // Legacy shape from before the envelope carried a version: a bare array.
  if (Array.isArray(value))
    return { kind: "views", views: value, migrated: true };
  const raw = asRecord(value);
  if (raw === null) return { kind: "invalid" };
  // Version first: a future envelope may rename/move `views`, and that must
  // still read as "newer", not as damaged data that gets quarantined.
  if (typeof raw.version === "number") {
    if (raw.version > SAVED_VIEWS_VERSION) return { kind: "unsupported" };
    if (raw.version !== 1 && raw.version !== SAVED_VIEWS_VERSION)
      return { kind: "invalid" };
  } else if (raw.version !== undefined) {
    return { kind: "invalid" };
  }
  if (!Array.isArray(raw.views)) return { kind: "invalid" };
  return {
    kind: "views",
    views: raw.views,
    migrated: raw.version !== SAVED_VIEWS_VERSION,
  };
}

/**
 * Read and sanitize the saved views for one account + board. Never throws:
 * unavailable storage reads as an empty list, and damaged data is copied
 * aside (when possible) before the caller starts from an empty list.
 */
export function loadSavedViews(
  userId: string,
  boardId: string,
): SavedViewsLoadResult {
  const key = savedViewsKey(userId, boardId);
  const stored = readJSON<unknown>(key);
  if (stored.status === "missing") return { status: "missing", views: [] };
  if (stored.status === "unavailable") {
    return { status: "unavailable", views: [] };
  }
  if (stored.status === "corrupt") {
    return {
      status: "corrupt",
      views: [],
      quarantineKey: stored.quarantineKey,
    };
  }

  const payload = parsePayload(stored.value);
  if (payload.kind === "unsupported") {
    return { status: "unsupported", views: [] };
  }
  if (payload.kind === "invalid") {
    // Valid JSON of the wrong shape would otherwise be replaced silently by
    // the next save, so preserve it exactly like unparsable text.
    const raw = readRaw(key);
    return {
      status: "corrupt",
      views: [],
      quarantineKey: raw === null ? null : quarantineValue(key, raw),
    };
  }
  return {
    status: "ok",
    views: sanitizeSavedViews(payload.views),
    ...(payload.migrated ? { migrated: true } : {}),
  };
}

/**
 * Cheap read for the trigger badge: parse without quarantining or rewriting.
 * Damage/newer payloads simply read as zero — the panel explains them when
 * opened. Keeping this side-effect free avoids double-quarantining a broken
 * key before the panel's real load.
 */
export function peekSavedViewsCount(userId: string, boardId: string): number {
  const raw = readRaw(savedViewsKey(userId, boardId));
  if (raw === null) return 0;
  try {
    const payload = parsePayload(JSON.parse(raw) as unknown);
    return payload.kind === "views"
      ? sanitizeSavedViews(payload.views).length
      : 0;
  } catch {
    return 0;
  }
}

/** Does an existing quarantine copy hold exactly these raw bytes? */
function hasQuarantineCopy(key: string, raw: string): boolean {
  return listQuarantineKeys(key).some((copy) => readRaw(copy) === raw);
}

/**
 * Persist views (sanitized first) in the current envelope. The existing key is
 * inspected at write time as well: a newer payload version is never
 * overwritten, and damaged data is only replaced after a quarantine copy
 * exists. Returns the exact sanitized list that was written.
 */
export function saveSavedViews(
  userId: string,
  boardId: string,
  views: readonly SavedView[],
): SaveSavedViewsResult {
  const key = savedViewsKey(userId, boardId);
  const stored = readJSON<unknown>(key);
  if (stored.status === "ok") {
    const payload = parsePayload(stored.value);
    if (payload.kind === "unsupported") {
      return { ok: false, reason: "newer-version" };
    }
    if (payload.kind === "invalid") {
      // Valid JSON of the wrong shape is only replaceable once its raw bytes
      // are safely copied aside. A copy from the earlier load counts too —
      // retrying the copy after a quota failure must not create a false lock.
      const raw = readRaw(key);
      if (
        raw === null ||
        (!hasQuarantineCopy(key, raw) && quarantineValue(key, raw) === null)
      ) {
        return { ok: false, reason: "corrupt" };
      }
    }
  } else if (stored.status === "corrupt") {
    const raw = readRaw(key);
    if (
      raw === null ||
      (!hasQuarantineCopy(key, raw) && quarantineValue(key, raw) === null)
    ) {
      // The read-time copy failed (quota/private mode): the unparsable text is
      // the user's only copy, so lock writes instead of destroying it.
      return { ok: false, reason: "corrupt" };
    }
  }

  const sanitized = sanitizeSavedViews(views);
  return saveJSON(key, { version: SAVED_VIEWS_VERSION, views: sanitized })
    ? { ok: true, views: sanitized }
    : { ok: false, reason: "storage" };
}

/**
 * Add a view. Rejects empty filters, blank/over-long names, case-insensitive
 * duplicates and the 20-view cap. The list is sanitized first so callers
 * cannot bypass the invariants by passing hand-built data.
 */
export function createSavedView(
  views: readonly SavedView[],
  input: { name: string; filter: CardFilter; view?: SavedViewProjection },
): SavedViewMutation {
  const current = sanitizeSavedViews(views);
  const name = input.name.trim();
  if (name === "" || name.length > SAVED_VIEW_NAME_LIMIT) {
    return { ok: false, reason: "invalid-name" };
  }
  const filter = sanitizeSavedViewFilter(input.filter);
  if (filter === null) return { ok: false, reason: "empty-filter" };
  if (current.some((view) => view.name.toLowerCase() === name.toLowerCase())) {
    return { ok: false, reason: "duplicate" };
  }
  if (current.length >= MAX_SAVED_VIEWS) return { ok: false, reason: "limit" };
  const view: SavedView = {
    name,
    filter,
    ...(isSavedViewProjection(input.view) ? { view: input.view } : {}),
  };
  return { ok: true, views: [...current, view], view };
}

/**
 * Rename one view by its current name. A case-only change is allowed, while
 * a name taken by another view (case-insensitively) is rejected.
 */
export function renameSavedView(
  views: readonly SavedView[],
  targetName: string,
  nextName: string,
): SavedViewMutation {
  const current = sanitizeSavedViews(views);
  const index = current.findIndex(
    (view) => view.name.toLowerCase() === targetName.trim().toLowerCase(),
  );
  if (index === -1) return { ok: false, reason: "not-found" };
  const name = nextName.trim();
  if (name === "" || name.length > SAVED_VIEW_NAME_LIMIT) {
    return { ok: false, reason: "invalid-name" };
  }
  if (
    current.some(
      (view, viewIndex) =>
        viewIndex !== index && view.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    return { ok: false, reason: "duplicate" };
  }
  const view: SavedView = { ...current[index], name };
  const next = current.map((entry, viewIndex) =>
    viewIndex === index ? view : entry,
  );
  return { ok: true, views: next, view };
}

/** Remove a view by name (case-insensitively); unknown names are a no-op. */
export function removeSavedView(
  views: readonly SavedView[],
  targetName: string,
): SavedView[] {
  const target = targetName.trim().toLowerCase();
  return views.filter((view) => view.name.toLowerCase() !== target);
}

/**
 * TASK-177.20.2 drift policy: labels and assignees that were deleted from
 * the board are removed from every saved filter. A view whose last facet was
 * one of those options becomes an empty filter and is dropped — applying it
 * would silently clear the board instead of restoring a view. `changed` and
 * `dropped` are scoped lists so the menu can warn only about the view the
 * user actually applied. A facet whose option source is not loaded yet is
 * left alone (undefined means unknown, not empty).
 */
export function pruneSavedViews(
  views: readonly SavedView[],
  options: SavedViewsOptions,
): PrunedSavedViews {
  const labels =
    options.labelIds === undefined ? null : new Set(options.labelIds);
  const assignees =
    options.assigneeIds === undefined ? null : new Set(options.assigneeIds);
  const epics = options.epicIds === undefined ? null : new Set(options.epicIds);
  if (labels === null && assignees === null && epics === null) {
    return {
      views: [...views],
      missingOptions: false,
      changedViewNames: [],
      droppedViewNames: [],
    };
  }

  const next: SavedView[] = [];
  const changedViewNames: string[] = [];
  const droppedViewNames: string[] = [];
  for (const view of views) {
    const labelIds = labels
      ? view.filter.labelIds.filter((id) => labels.has(id))
      : view.filter.labelIds;
    const assigneeIds = assignees
      ? view.filter.assignees.filter((id) => assignees.has(id))
      : view.filter.assignees;
    const epicIds = epics
      ? view.filter.epicIds.filter((id) => epics.has(id))
      : view.filter.epicIds;
    const changed =
      labelIds.length !== view.filter.labelIds.length ||
      assigneeIds.length !== view.filter.assignees.length ||
      epicIds.length !== view.filter.epicIds.length;
    if (!changed) {
      next.push(view);
      continue;
    }
    const filter = {
      ...view.filter,
      labelIds,
      assignees: assigneeIds,
      epicIds,
    };
    if (!isFilterActive(filter)) {
      droppedViewNames.push(view.name);
      continue;
    }
    changedViewNames.push(view.name);
    next.push({ ...view, filter });
  }
  return {
    views: next,
    missingOptions: changedViewNames.length > 0 || droppedViewNames.length > 0,
    changedViewNames,
    droppedViewNames,
  };
}
