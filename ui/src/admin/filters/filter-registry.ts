import {
  ADMIN_MIME_FAMILIES,
  CARD_LINK_TYPES,
  CARD_PRIORITIES,
  COMMENT_KINDS,
  ENTITY_FILTERS,
  type AdminFilterOptionDto,
  type AdminFilterOptionType,
} from "@janosik/shared";
import type { AdminMessageKey, AdminT } from "../admin-i18n";
import type { AdminListFilters } from "../admin-list-query";

export const FILTER_BAR_TITLES = {
  users: "admin.filters.title.users",
  boards: "admin.filters.title.boards",
  cards: "admin.filters.title",
  columns: "admin.filters.title.columns",
  labels: "admin.filters.title.labels",
  checklists: "admin.filters.title.checklists",
  cardLinks: "admin.filters.title.cardLinks",
  comments: "admin.filters.title.comments",
  attachments: "admin.filters.title.attachments",
  audit: "admin.filters.title.audit",
  commands: "admin.filters.title.commands",
  activity: "admin.filters.title.activity",
} as const satisfies Record<string, AdminMessageKey>;

export type FilterBarSurface = keyof typeof FILTER_BAR_TITLES;

const definitions = {
  boardId: { kind: "lookup", type: "board", label: "admin.filter.board" },
  columnId: { kind: "lookup", type: "column", label: "admin.filter.column" },
  cardId: { kind: "lookup", type: "card", label: "admin.filter.card" },
  adminMemberId: {
    kind: "lookup",
    type: "user",
    label: "admin.filters.adminMember",
  },
  assigneeId: { kind: "multi", type: "user", label: "admin.filters.assignee" },
  labelId: { kind: "multi", type: "label", label: "admin.filter.label" },
  authorId: { kind: "lookup", type: "user", label: "admin.filters.author" },
  uploadedById: {
    kind: "lookup",
    type: "user",
    label: "admin.filters.uploader",
  },
  kind: { kind: "multi", label: "admin.filters.kind" },
  type: { kind: "multi", label: "admin.filters.linkType" },
  adminId: {
    kind: "multi",
    type: "auditActor",
    label: "admin.audit.column.admin",
  },
  actorId: {
    kind: "multi",
    type: "user",
    label: "admin.activity.column.actor",
  },
  action: { kind: "multi", type: "action", label: "admin.audit.column.action" },
  targetType: {
    kind: "multi",
    type: "targetType",
    label: "admin.filters.targetType",
  },
  targetId: { kind: "id", label: "admin.filters.targetId" },
  commandId: { kind: "id", label: "admin.filter.commandId" },
  verified: { kind: "radio", label: "admin.filters.verified" },
  mime: { kind: "radio", label: "admin.filters.mime" },
  transcode: { kind: "radio", label: "admin.filters.transcode" },
  priority: { kind: "multi", label: "admin.filters.priority" },
  due: { kind: "radio", label: "admin.filters.due" },
  hasAttachments: { kind: "radio", label: "admin.filters.attachments" },
} as const satisfies Record<
  string,
  {
    kind: "lookup" | "multi" | "radio" | "id";
    type?: AdminFilterOptionType;
    label: AdminMessageKey;
  }
>;

type FacetKey = keyof typeof definitions;
export type FilterKey = FacetKey | "labelMatch" | "unassigned";

export function filterFacet<Key extends FacetKey>(key: Key) {
  return { key, ...definitions[key] } as {
    key: Key;
  } & (typeof definitions)[Key];
}

const eventTypes = {
  commands: {
    key: "type",
    kind: "multi",
    type: "commandType",
    label: "admin.commands.column.type",
  },
  activity: {
    key: "type",
    kind: "multi",
    type: "activityType",
    label: "admin.activity.column.type",
  },
} as const satisfies Record<
  string,
  {
    key: "type";
    kind: "multi";
    type: AdminFilterOptionType;
    label: AdminMessageKey;
  }
>;

const commandActor = {
  ...filterFacet("actorId"),
  label: "admin.commands.filter.actor",
} as const;

export type FilterFacet =
  | {
      [Key in FacetKey]: ReturnType<typeof filterFacet<Key>>;
    }[FacetKey]
  | (typeof eventTypes)[keyof typeof eventTypes]
  | typeof commandActor;

export type LookupFacet = Extract<FilterFacet, { type: AdminFilterOptionType }>;
export type DraftFacet = Extract<FilterFacet, { kind: "multi" }>;
export type ChoiceFacet = Extract<FilterFacet, { kind: "radio" }>;

export function offeredFilters(surface: FilterBarSurface): FilterFacet[] {
  const { implemented, offered } = ENTITY_FILTERS[surface];
  return offered.flatMap((key) => {
    if (!implemented.includes(key) || !Object.hasOwn(definitions, key))
      return [];
    if (key === "type" && (surface === "commands" || surface === "activity"))
      return [eventTypes[surface]];
    if (key === "actorId" && surface === "commands") return [commandActor];
    return [filterFacet(key as FacetKey) as FilterFacet];
  });
}

export function filterLabel(
  key: string,
  surface: FilterBarSurface,
): AdminMessageKey | undefined {
  if (key === "unassigned") return "admin.filters.unassigned";
  if (key === "labelMatch") return "admin.filters.labelMatch";
  if (key === "type") {
    if (surface === "commands" || surface === "activity")
      return eventTypes[surface].label;
    return surface === "cardLinks" ? definitions.type.label : undefined;
  }
  if (key === "actorId" && surface === "commands") return commandActor.label;
  return Object.hasOwn(definitions, key)
    ? definitions[key as FacetKey].label
    : undefined;
}

export function selectedFilterValues(
  filters: AdminListFilters | undefined,
  key: FilterKey,
): readonly string[] {
  const value = filters?.[key];
  return Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];
}

export type FilterChoice<Value extends string | boolean = string | boolean> = {
  value: Value;
  label: AdminMessageKey;
};

export const PRIORITY_CHOICES = CARD_PRIORITIES.map((value) => ({
  value,
  label: `admin.filters.priority.${value}` as const,
}));

export const KIND_CHOICES = COMMENT_KINDS.map((value) => ({
  value,
  label: `admin.filters.kind.${value}` as const,
}));

export const LINK_TYPE_CHOICES = CARD_LINK_TYPES.map((value) => ({
  value,
  label: `admin.filters.linkType.${value}` as const,
}));

export const RADIO_FILTERS = {
  verified: {
    label: "admin.filters.verified.control",
    choices: [
      { value: true, label: "admin.filters.verified.yes" },
      { value: false, label: "admin.filters.verified.no" },
    ],
  },
  due: {
    label: "admin.filters.due.control",
    choices: [
      { value: "overdue", label: "admin.filters.due.overdue" },
      { value: "soon", label: "admin.filters.due.soon" },
      { value: "none", label: "admin.filters.due.none" },
    ],
  },
  hasAttachments: {
    label: "admin.filters.attachments.control",
    choices: [
      { value: true, label: "admin.filters.attachments.has" },
      { value: false, label: "admin.filters.attachments.none" },
    ],
  },
  mime: {
    label: "admin.filters.mime.control",
    choices: ADMIN_MIME_FAMILIES.map((value) => ({
      value,
      label: `admin.filters.mime.${value}` as const,
    })),
  },
  transcode: {
    label: "admin.filters.transcode.control",
    choices: (["pending", "failed", "done", "none"] as const).map((value) => ({
      value,
      label: `admin.filters.transcode.${value}` as const,
    })),
  },
} as const satisfies Record<
  ChoiceFacet["key"],
  {
    label: AdminMessageKey;
    choices: readonly FilterChoice[];
  }
>;

export function removeListFilter(
  filters: AdminListFilters,
  key: FilterKey,
  value?: string,
): Partial<AdminListFilters> {
  if (key === "priority") {
    return {
      priority:
        value === undefined
          ? undefined
          : filters.priority?.filter((priority) => priority !== value),
    };
  }
  if (
    key === "kind" ||
    key === "type" ||
    key === "actorId" ||
    key === "adminId" ||
    key === "action" ||
    key === "targetType"
  ) {
    return {
      [key]:
        value === undefined
          ? undefined
          : filters[key]?.filter((entry) => entry !== value),
    };
  }
  if (key === "labelId" || key === "assigneeId") {
    const remaining = selectedFilterValues(filters, key).filter(
      (id) => id !== value && value !== undefined,
    );
    if (key === "labelId") {
      return {
        labelId: remaining.length > 0 ? remaining : null,
        labelMatch: remaining.length > 1 ? filters.labelMatch : undefined,
      };
    }
    return { assigneeId: remaining };
  }
  if (
    key === "boardId" ||
    key === "columnId" ||
    key === "cardId" ||
    key === "commandId"
  )
    return { [key]: null };
  return { [key]: undefined };
}

export const BOARD_DEPENDENTS = ["columnId", "labelId", "cardId"] as const;

export function isPeopleLookup(facet: FilterFacet): boolean {
  return (
    "type" in facet && (facet.type === "user" || facet.type === "auditActor")
  );
}

export function isCodeLookup(facet: LookupFacet): boolean {
  return (
    facet.key === "action" || facet.key === "targetType" || facet.key === "type"
  );
}

export function shortId(id: string): string {
  // CUIDs created together can share a timestamp prefix. Their random
  // suffix distinguishes boards when operators search for identical titles.
  return /^c[a-z0-9]{24}$/.test(id) ? id.slice(-8) : id.slice(0, 8);
}

export function optionIds(
  id: string,
  option?: AdminFilterOptionDto,
  short = true,
): string {
  const format = (value: string) => (short ? shortId(value) : value);
  const parent = [option?.boardId, option?.columnId]
    .filter((value): value is string => typeof value === "string")
    .map(format)
    .join("/");
  return parent ? `${format(id)} · ${parent}` : format(id);
}

export function optionState(
  t: AdminT,
  state: AdminFilterOptionDto["state"] | undefined,
): string | undefined {
  if (state === "archived") return t("admin.filters.archived");
  if (state === "deleted") return t("admin.filters.deleted");
  if (state === "disabled") return t("admin.filters.disabled");
  return undefined;
}
