import type { ActivityFeedEntry, CardPriority } from "@janosik/shared";
import { CARD_PRIORITIES } from "@janosik/shared";

import { formatDate, type MessageKey } from "@/i18n";
import { priorityLabel } from "@/utils/priority";

/**
 * One activity-feed line rendered as a localized sentence (TASK-37). Shared
 * by the per-card History section and the board-wide Watch view so the two
 * feeds read identically; the maps cover both the server command types
 * (`UPDATE_CARD`, `MOVE_CARD`, …) and the client-local event types.
 */

/** Local timeline event types (no server round-trip) → catalog keys. */
const LOCAL_KEYS = {
  created: "activity.created",
  renamed: "activity.renamed",
  "description-changed": "activity.description-changed",
  moved: "activity.moved",
  "label-added": "activity.label-added",
  "label-removed": "activity.label-removed",
  "due-date-set": "activity.due-date-set",
  "due-date-removed": "activity.due-date-removed",
  "link-added": "activity.link-added",
  "link-removed": "activity.link-removed",
  "cover-set": "activity.cover-set",
  "cover-removed": "activity.cover-removed",
  "checklist-added": "activity.checklist-added",
  "checklist-removed": "activity.checklist-removed",
  "checklist-renamed": "activity.checklist-renamed",
  "checklist-item-added": "activity.checklist-item-added",
  "checklist-item-checked": "activity.checklist-item-checked",
  "checklist-item-unchecked": "activity.checklist-item-unchecked",
  "checklist-item-removed": "activity.checklist-item-removed",
  "checklist-item-renamed": "activity.checklist-item-renamed",
  archived: "activity.archived",
  unarchived: "activity.unarchived",
} satisfies Record<string, MessageKey>;

/** Server command types → catalog keys (special cases resolved per entry). */
const COMMAND_KEYS: Record<string, MessageKey> = {
  ADD_CARD: "activity.created",
  CREATE_CARD: "activity.created",
  UPDATE_CARD: "history.updated",
  MOVE_CARD: "activity.moved",
  SET_CARD_DUE_DATE: "activity.due-date-set",
  SET_CARD_PRIORITY: "activity.priority-set",
  SET_CARD_ASSIGN: "activity.assignee-set",
  CLAIM_CARD: "activity.claimed",
  SET_CARD_TASK_SPEC: "activity.task-spec-changed",
  ADD_CARD_LINK: "activity.link-added",
  REMOVE_CARD_LINK: "activity.link-removed",
  SET_CARD_COVER: "activity.cover-set",
  SET_CARD_LABEL: "activity.label-added",
  ADD_CHECKLIST: "activity.checklist-added",
  RENAME_CHECKLIST: "activity.checklist-renamed",
  DELETE_CHECKLIST: "activity.checklist-removed",
  ADD_CHECKLIST_ITEM: "activity.checklist-item-added",
  SET_CHECKLIST_ITEM_DONE: "activity.checklist-item-checked",
  RENAME_CHECKLIST_ITEM: "activity.checklist-item-renamed",
  DELETE_CHECKLIST_ITEM: "activity.checklist-item-removed",
  ARCHIVE_CARD: "activity.archived",
  UNARCHIVE_CARD: "activity.unarchived",
  DELETE_CARD: "activity.deleted",
  DUPLICATE_CARD: "activity.created",
  // Bookkeeping only (filtered out of the watch feed); the card history still
  // shows it.
  TOUCH_CARD: "history.updated",
  // Labels.
  ADD_LABEL: "activity.label-created",
  RENAME_LABEL: "activity.label-renamed",
  SET_LABEL_COLOR: "activity.label-color",
  DELETE_LABEL: "activity.label-deleted",
  // Board- and column-level commands (no card): without these they fell back
  // to the card-centric "Updated the card".
  ADD_COLUMN: "activity.column-added",
  DUPLICATE_COLUMN: "activity.column-added",
  RENAME_COLUMN: "activity.column-renamed",
  DELETE_COLUMN: "activity.column-removed",
  MOVE_COLUMN: "activity.column-moved",
  SORT_COLUMN: "activity.column-sorted",
  SET_COLUMN_CARD_ORDER: "activity.column-reordered",
  SET_COLUMN_WIP_LIMIT: "activity.column-updated",
  ARCHIVE_COLUMN_CARDS: "activity.column-archived",
  RENAME_BOARD: "activity.board-renamed",
  ARCHIVE_BOARD: "activity.board-archived",
  UNARCHIVE_BOARD: "activity.board-unarchived",
  ADD_BOARD: "activity.board-created",
  REMOVE_BOARD: "activity.board-deleted",
  IMPORT_BOARDS: "activity.board-imported",
  // Restores (undo / admin): rare, but they still deserve a sentence.
  RESTORE_CARD: "activity.restored",
  RESTORE_COLUMN: "activity.column-restored",
  RESTORE_COLUMN_CARDS: "activity.column-restored",
  RESTORE_LABEL: "activity.label-restored",
  RESTORE_CHECKLIST: "activity.checklist-restored",
  RESTORE_CHECKLIST_ITEM: "activity.checklist-item-restored",
  RESTORE_BOARD: "activity.board-restored",
};

/** Field label keys for the "from → to" lines. */
export const FIELD_KEYS: Record<string, MessageKey> = {
  title: "history.field.title",
  description: "history.field.description",
  dueDate: "history.field.dueDate",
  priority: "history.field.priority",
  assignee: "history.field.assignee",
  claimedBy: "history.field.claimedBy",
  leaseUntil: "history.field.leaseUntil",
  acceptanceCriteria: "history.field.acceptanceCriteria",
  definitionOfDone: "history.field.definitionOfDone",
  link: "history.field.link",
  column: "history.field.column",
  label: "history.field.label",
  checklist: "history.field.checklist",
  checklistItem: "history.field.checklistItem",
  comment: "history.field.comment",
  cover: "history.field.cover",
};

/**
 * One side of a `from → to` diff rendered as display text: dates and
 * priorities are localized, an assignee is resolved to a name by the caller,
 * and `null` reads as an em dash. Shared by the card History and the Watch
 * feed so both render the same values.
 */
export function formatChangeValue(
  field: string,
  value: string | null,
  lang: "en" | "ru",
  hour12: boolean,
  memberName?: (userId: string) => string,
): string {
  if (value === null) return "—";
  if (field === "dueDate") {
    const at = Date.parse(value);
    if (Number.isFinite(at)) return formatDate(at, lang, hour12);
  }
  if (field === "priority" && CARD_PRIORITIES.includes(value as CardPriority)) {
    return priorityLabel(value as CardPriority, lang);
  }
  if (field === "assignee" || field === "claimedBy") {
    return memberName ? memberName(value) : value;
  }
  return value;
}

/** The sentence for one entry: special cases first, maps as fallback. */
export function sentenceFor(
  entry: ActivityFeedEntry,
  lang: "en" | "ru",
  hour12: boolean,
  assigneeName: string | null = null,
): { key: MessageKey; params?: Record<string, string> } {
  const local = LOCAL_KEYS[entry.type as keyof typeof LOCAL_KEYS];
  if (local !== undefined) {
    return { key: local, params: { detail: entry.detail ?? "" } };
  }

  if (entry.type === "UPDATE_CARD") {
    const fields = entry.changes?.map((change) => change.field) ?? [];
    if (fields.length === 1 && fields[0] === "title") {
      return { key: "activity.renamed" };
    }
    if (fields.length === 1 && fields[0] === "description") {
      return { key: "activity.description-changed" };
    }
    return { key: "history.updated" };
  }

  // A move without a captured destination would read "Moved to" — degrade to
  // a bare "Moved" instead (the board feed does not always carry a snapshot).
  if (entry.type === "MOVE_CARD" && !entry.detail) {
    return { key: "activity.movedPlain" };
  }

  if (entry.type === "SET_CARD_LABEL") {
    const attached = entry.changes?.[0]?.to ?? null;
    return {
      key:
        attached !== null ? "activity.label-added" : "activity.label-removed",
      params: { detail: entry.detail ?? attached ?? "" },
    };
  }

  if (entry.type === "SET_CARD_DUE_DATE") {
    const set = entry.changes?.[0]?.to ?? null;
    return {
      key: set !== null ? "activity.due-date-set" : "activity.due-date-removed",
      params: {
        detail: set !== null ? formatDate(Date.parse(set), lang, hour12) : "",
      },
    };
  }

  if (entry.type === "SET_CARD_PRIORITY") {
    const to = entry.changes?.[0]?.to ?? null;
    // Every SET_CARD_PRIORITY carries a known priority as `to`; fall back
    // to the default for degenerate feeds. `activity.priority-set`
    // interpolates the localized name, not the raw value.
    const detail =
      to !== null && CARD_PRIORITIES.includes(to as CardPriority)
        ? priorityLabel(to as CardPriority, lang)
        : priorityLabel("medium", lang);
    return { key: "activity.priority-set", params: { detail } };
  }

  if (entry.type === "SET_CARD_ASSIGN" || entry.type === "assignee-set") {
    // The subject's name is resolved by the caller (member directory);
    // a null `to` (or an unresolvable id) reads as "unassigned". The
    // activity event carries the id in `detail` (`""` = unassigned).
    if (assigneeName === null || assigneeName === "") {
      return { key: "activity.assignee-unassigned" };
    }
    return { key: "activity.assignee-set", params: { detail: assigneeName } };
  }

  if (entry.type === "CLAIM_CARD") {
    // The claimant is shown in the from → to diff (resolved to a member
    // name there); the sentence stays name-free.
    const to =
      entry.changes?.find((change) => change.field === "claimedBy")?.to ?? null;
    return to === null
      ? { key: "activity.claim-released" }
      : { key: "activity.claimed" };
  }

  if (entry.type === "SET_CARD_COVER") {
    const set = entry.changes?.[0]?.to ?? null;
    return {
      key: set !== null ? "activity.cover-set" : "activity.cover-removed",
    };
  }

  if (entry.type === "SET_CHECKLIST_ITEM_DONE") {
    const checked =
      entry.changes?.some(
        (change) =>
          change.field === "checklistItemDone" && change.to === "true",
      ) ?? entry.detail !== undefined;
    return {
      key: checked
        ? "activity.checklist-item-checked"
        : "activity.checklist-item-unchecked",
      params: { detail: entry.detail ?? "" },
    };
  }

  if (entry.type === "comment_added") {
    return { key: "activity.comment-added" };
  }
  if (entry.type === "comment_deleted") {
    return { key: "activity.comment-deleted" };
  }

  return {
    key: COMMAND_KEYS[entry.type] ?? "activity.changed",
    params: { detail: entry.detail ?? "" },
  };
}
