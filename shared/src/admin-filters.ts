import {
  CARD_LINK_TYPES,
  CARD_PRIORITIES,
  COMMENT_KINDS,
  type CardPriority,
  type CommentKind,
} from "./types/kanban";
import type { AdminListSurface } from "./admin";
import {
  ADMIN_CARD_SCOPE,
  ADMIN_ID_PATTERN,
  parseAdminFilterId,
} from "./admin-filter-scope";

export const ADMIN_FILTER_CODE_PATTERN = /^[A-Za-z0-9_:.-]{1,100}$/;
export const ADMIN_FILTER_TARGET_ID_PATTERN = /^[A-Za-z0-9_:-]{1,100}$/;
export const ADMIN_FILTER_MAX_VALUES = 20;
export const ADMIN_FILTER_MAX_TOTAL_VALUES = 32;
export const ADMIN_FILTER_MAX_QUERY_LENGTH = 2048;
export const ADMIN_FILTER_QUERY_MAX_LENGTH = 200;

const DUE_VALUES = ["overdue", "soon", "none"] as const;
export const ADMIN_MIME_FAMILIES = [
  "image",
  "video",
  "pdf",
  "document",
  "other",
] as const;
export const ADMIN_TRANSCODE_STATUSES = [
  "none",
  "pending",
  "done",
  "failed",
] as const;

export interface AdminFilterValues {
  action: string[];
  actorId: string[];
  adminId: string[];
  adminMemberId: string;
  assigneeId: string[];
  authorId: string;
  boardId: string;
  cardId: string;
  columnId: string;
  commandId: string;
  due: (typeof DUE_VALUES)[number];
  hasAttachments: boolean;
  kind: CommentKind[];
  labelId: string | string[];
  labelMatch: "any" | "all";
  mime: (typeof ADMIN_MIME_FAMILIES)[number];
  priority: CardPriority[];
  targetId: string;
  targetType: string[];
  transcode: (typeof ADMIN_TRANSCODE_STATUSES)[number];
  type: string[];
  unassigned: boolean;
  uploadedById: string;
  verified: boolean;
}

export type AdminFilterKey = keyof AdminFilterValues;
export type AdminFilters = Partial<AdminFilterValues>;

type FilterField = RegExp | readonly string[] | "boolean";
const FILTER_FIELDS: Record<AdminFilterKey, FilterField> = {
  action: ADMIN_FILTER_CODE_PATTERN,
  actorId: ADMIN_ID_PATTERN,
  adminId: ADMIN_ID_PATTERN,
  adminMemberId: ADMIN_ID_PATTERN,
  assigneeId: ADMIN_ID_PATTERN,
  authorId: ADMIN_ID_PATTERN,
  boardId: ADMIN_ID_PATTERN,
  cardId: ADMIN_ID_PATTERN,
  columnId: ADMIN_ID_PATTERN,
  commandId: ADMIN_ID_PATTERN,
  due: DUE_VALUES,
  hasAttachments: "boolean",
  kind: COMMENT_KINDS,
  labelId: ADMIN_ID_PATTERN,
  labelMatch: ["any", "all"],
  mime: ADMIN_MIME_FAMILIES,
  priority: CARD_PRIORITIES,
  targetId: ADMIN_FILTER_TARGET_ID_PATTERN,
  targetType: ADMIN_FILTER_CODE_PATTERN,
  transcode: ADMIN_TRANSCODE_STATUSES,
  type: ADMIN_FILTER_CODE_PATTERN,
  unassigned: "boolean",
  uploadedById: ADMIN_ID_PATTERN,
  verified: "boolean",
};

// Pure initializers let the bundler omit the registry when only other shared
// exports are used.
function sortedFilterKeys(): AdminFilterKey[] {
  return (Object.keys(FILTER_FIELDS) as AdminFilterKey[]).sort();
}

export const ADMIN_FILTER_KEYS = /* @__PURE__ */ sortedFilterKeys();

function createMultiValueLimits(): Partial<Record<AdminFilterKey, number>> {
  return {
    action: ADMIN_FILTER_MAX_VALUES,
    actorId: ADMIN_FILTER_MAX_VALUES,
    adminId: ADMIN_FILTER_MAX_VALUES,
    assigneeId: ADMIN_FILTER_MAX_VALUES,
    kind: COMMENT_KINDS.length,
    priority: CARD_PRIORITIES.length,
    targetType: ADMIN_FILTER_MAX_VALUES,
    type: ADMIN_FILTER_MAX_VALUES,
  };
}

const MULTI_VALUE_LIMITS = /* @__PURE__ */ createMultiValueLimits();

export interface AdminFilterSurfaceConfig {
  /** Facets accepted by the API in the current rollout. */
  implemented: readonly AdminFilterKey[];
  /** Facets planned for the filter picker, including later rollout waves. */
  offered: readonly AdminFilterKey[];
  /** API support for from/to in the current rollout. */
  dateRange: boolean;
  period: boolean;
  statusTabs: boolean;
}

const BOARD_CARD_SCOPE = ["boardId", "cardId"] as const;
const EVENT_FACETS = ["actorId", "type"] as const;
const COMMAND_FACETS = [
  "boardId",
  ...EVENT_FACETS,
  "cardId",
  "columnId",
  "commandId",
] as const;
const AUDIT_FACETS = [
  "adminId",
  "action",
  "targetType",
  "targetId",
  "commandId",
] as const;
const CARD_FACETS = [
  "boardId",
  "columnId",
  "labelId",
  "labelMatch",
  "assigneeId",
  "unassigned",
  "priority",
  "due",
  "hasAttachments",
] as const;

function filterSurface(
  implemented: readonly AdminFilterKey[],
  offered: readonly AdminFilterKey[] = [],
  {
    statusTabs = false,
    period = false,
    dateRange = period,
  }: Partial<
    Pick<AdminFilterSurfaceConfig, "statusTabs" | "period" | "dateRange">
  > = {},
): AdminFilterSurfaceConfig {
  return { implemented, offered, dateRange, period, statusTabs };
}

const STATUS_TABS = { statusTabs: true };
const PERIOD_TABS = { period: true };

function createEntityFilters(): Record<
  AdminListSurface,
  AdminFilterSurfaceConfig
> {
  const statusAndPeriodTabs = { ...STATUS_TABS, ...PERIOD_TABS };
  return {
    users: filterSurface(["verified"], ["verified"], statusAndPeriodTabs),
    boards: filterSurface(
      [...ADMIN_CARD_SCOPE, "adminMemberId"],
      ["adminMemberId"],
      STATUS_TABS,
    ),
    cards: filterSurface(
      ["cardId", ...CARD_FACETS],
      CARD_FACETS,
      statusAndPeriodTabs,
    ),
    columns: filterSurface(ADMIN_CARD_SCOPE, ["boardId"], STATUS_TABS),
    labels: filterSurface(ADMIN_CARD_SCOPE, ["boardId"], STATUS_TABS),
    checklists: filterSurface(ADMIN_CARD_SCOPE, BOARD_CARD_SCOPE, STATUS_TABS),
    checklistItems: filterSurface(ADMIN_CARD_SCOPE),
    cardLinks: filterSurface(
      [...BOARD_CARD_SCOPE, "type"],
      [...BOARD_CARD_SCOPE, "type"],
      STATUS_TABS,
    ),
    comments: filterSurface(
      [...ADMIN_CARD_SCOPE, "authorId", "kind"],
      [...BOARD_CARD_SCOPE, "authorId", "kind"],
      statusAndPeriodTabs,
    ),
    attachments: filterSurface(
      [...ADMIN_CARD_SCOPE, "uploadedById", "mime", "transcode"],
      [...BOARD_CARD_SCOPE, "uploadedById", "mime", "transcode"],
      statusAndPeriodTabs,
    ),
    activity: filterSurface(
      [...ADMIN_CARD_SCOPE, ...EVENT_FACETS],
      [...BOARD_CARD_SCOPE, ...EVENT_FACETS],
      PERIOD_TABS,
    ),
    commands: filterSurface(COMMAND_FACETS, COMMAND_FACETS, PERIOD_TABS),
    audit: filterSurface(AUDIT_FACETS, AUDIT_FACETS, PERIOD_TABS),
    sessions: filterSurface([], [], PERIOD_TABS),
    tokens: filterSurface([], [], PERIOD_TABS),
    shares: filterSurface(["boardId"], [], { dateRange: true }),
    announcements: filterSurface([], [], STATUS_TABS),
    boardMembers: filterSurface(["boardId"]),
    cardLabels: filterSurface(ADMIN_CARD_SCOPE),
    admins: filterSurface([]),
  };
}

export const ENTITY_FILTERS = /* @__PURE__ */ createEntityFilters();

const ALL_STATUS = ["all"] as const;
const DELETABLE_STATUS = ["all", "active", "deleted"] as const;
const ARCHIVABLE_STATUS = ["all", "active", "archived", "deleted"] as const;
const DISABLABLE_STATUS = ["all", "active", "disabled"] as const;
export const ENTITY_STATUS_VALUES: Record<AdminListSurface, readonly string[]> =
  {
    users: DISABLABLE_STATUS,
    boards: ARCHIVABLE_STATUS,
    cards: ARCHIVABLE_STATUS,
    columns: DELETABLE_STATUS,
    labels: DELETABLE_STATUS,
    checklists: DELETABLE_STATUS,
    checklistItems: DELETABLE_STATUS,
    cardLinks: DELETABLE_STATUS,
    comments: DELETABLE_STATUS,
    attachments: DELETABLE_STATUS,
    activity: ALL_STATUS,
    commands: ALL_STATUS,
    audit: ALL_STATUS,
    sessions: ALL_STATUS,
    tokens: DISABLABLE_STATUS,
    shares: ALL_STATUS,
    announcements: ["all", "active", "disabled", "deleted"],
    boardMembers: DISABLABLE_STATUS,
    cardLabels: ALL_STATUS,
    admins: ALL_STATUS,
  };

export function normalizeAdminStatus(
  surface: AdminListSurface | undefined,
  status: string,
): string {
  return surface === "announcements" && status === "deleted"
    ? "disabled"
    : status;
}

export function adminFilterValueLimit(
  key: AdminFilterKey,
  surface?: AdminListSurface,
): number {
  if (key === "labelId" && surface === "cards") return ADMIN_FILTER_MAX_VALUES;
  if (key === "type" && surface === "cardLinks") return CARD_LINK_TYPES.length;
  return MULTI_VALUE_LIMITS[key] ?? 1;
}

/** Parse one wire value. An undefined result indicates an invalid value. */
export function parseAdminFilterValue(
  key: AdminFilterKey,
  value: unknown,
  surface?: AdminListSurface,
): string | boolean | undefined {
  const field =
    key === "type" && surface === "cardLinks"
      ? CARD_LINK_TYPES
      : FILTER_FIELDS[key];
  if (field === "boolean") {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    return undefined;
  }
  if (field instanceof RegExp) return parseAdminFilterId(value, field);
  return typeof value === "string" && field.includes(value) ? value : undefined;
}

export function canonicalAdminFilterValues(
  values: readonly string[],
): string[] {
  return [...new Set(values.map((value) => value.trim()))].sort();
}

/** Canonical wire entries for a list, optionally restricted to its surface. */
export function adminFilterEntries(
  filters: Partial<
    Record<AdminFilterKey, string | boolean | readonly string[] | null>
  >,
  surface?: AdminListSurface,
): [AdminFilterKey, string][] {
  const implemented =
    surface === undefined
      ? ADMIN_FILTER_KEYS
      : ENTITY_FILTERS[surface].implemented;
  const labels = filters.labelId;
  const multipleLabels =
    Array.isArray(labels) &&
    canonicalAdminFilterValues(
      labels.filter(
        (id: string) => parseAdminFilterValue("labelId", id) !== undefined,
      ),
    ).length > 1;
  return ADMIN_FILTER_KEYS.flatMap((key): [AdminFilterKey, string][] => {
    if (!implemented.includes(key)) return [];
    const value = filters[key];
    if (
      value == null ||
      value === "" ||
      (key === "unassigned" && value === false)
    )
      return [];
    if (key === "labelMatch" && (value !== "all" || !multipleLabels)) return [];
    if (
      surface !== undefined &&
      Array.isArray(value) &&
      adminFilterValueLimit(key, surface) === 1
    )
      return [];
    const rawValues = typeof value === "object" ? value : [value];
    const values = rawValues.flatMap((entry) => {
      const parsed = parseAdminFilterValue(key, entry, surface);
      return parsed === undefined ? [] : [String(parsed)];
    });
    return canonicalAdminFilterValues(values).map((entry) => [key, entry]);
  });
}

export function adminFilterLimitError(
  entries: [string, string][],
): string | undefined {
  if (entries.length > ADMIN_FILTER_MAX_TOTAL_VALUES) {
    return `Too many filters. Use at most ${ADMIN_FILTER_MAX_TOTAL_VALUES} values.`;
  }
  if (
    new URLSearchParams(entries).toString().length >
    ADMIN_FILTER_MAX_QUERY_LENGTH
  ) {
    return "Filter state is too long. Use fewer or shorter filter values.";
  }
}
