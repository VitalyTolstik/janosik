import {
  compareEpics,
  workflowDoneColumnIds,
  type Board,
  type Epic,
  type EpicProgress,
} from "@janosik/shared";

import type { CardEpicChip } from "@/components/board/CardItem";
import {
  CARD_ROW_HEIGHT,
  COMPACT_CARD_ROW_HEIGHT,
  type WindowRow,
} from "@/hooks/use-card-window";

export interface EpicCollapseState {
  expanded: ReadonlySet<string>;
  completedOpen: boolean;
}

export interface BacklogEpic {
  epic: Epic;
  code: string;
  chip: CardEpicChip;
  dropId: number;
  childIds: string[];
  total: number;
  labelIds: string[];
  done: number;
  elsewhereDone: number;
  elsewhereOpen: number;
}

export function collectBacklogEpics(
  board: Board,
  summaryProgress?: ReadonlyMap<string, EpicProgress>,
): Map<string, BacklogEpic> {
  const epics = new Map<string, BacklogEpic>();
  const ordered = (board.epics ?? []).slice().sort(compareEpics);
  ordered.forEach((epic, index) => {
    const code = `EP-${epic.position + 1}`;
    epics.set(epic.id, {
      epic,
      code,
      chip: { code, title: epic.title, completed: epic.status === "completed" },
      // Card and column ids are strings, including on imported boards.
      dropId: index + 1,
      childIds: [],
      total: 0,
      labelIds: [],
      done: 0,
      elsewhereDone: 0,
      elsewhereOpen: 0,
    });
  });
  if (epics.size === 0) return epics;
  const doneColumns = new Set(workflowDoneColumnIds(board));
  const labels = new Map<BacklogEpic, Set<string>>();
  let incomplete = false;
  for (const [index, column] of board.columns.entries()) {
    const done = doneColumns.has(column.id);
    for (const id of column.cardIds) {
      const card = Object.hasOwn(board.cards, id) ? board.cards[id] : undefined;
      if (card === undefined) incomplete = true;
      if (card?.epicId === undefined || card.archivedAt !== undefined) continue;
      const entry = epics.get(card.epicId);
      if (!entry) continue;
      entry.childIds.push(id);
      entry.total++;
      if (done) entry.done++;
      if (index !== 0) {
        if (done) entry.elsewhereDone++;
        else entry.elsewhereOpen++;
      }
      let union = labels.get(entry);
      if (!union) labels.set(entry, (union = new Set()));
      for (const label of card.labelIds) union.add(label);
    }
  }
  for (const [entry, union] of labels) entry.labelIds = [...union];
  if (incomplete && summaryProgress) {
    for (const [id, entry] of epics) {
      const progress = summaryProgress.get(id);
      if (progress) {
        entry.total = progress.total;
        entry.done = progress.done;
      }
    }
  }
  return epics;
}

type BacklogRow = WindowRow &
  (
    | { kind: "epic"; entry: BacklogEpic; expanded: boolean }
    | { kind: "child"; cardId: string; entry: BacklogEpic }
    | { kind: "epic-footer"; entry: BacklogEpic }
    | { kind: "other"; count: number }
    | { kind: "card"; cardId: string }
    | { kind: "completed"; count: number }
    | { kind: "footer" }
  );

export interface BacklogRows {
  rows: BacklogRow[];
  cardIds: string[];
  hiddenCount: number;
}

export const OTHER_CARDS_DROP_ID = 0;

export function buildBacklogRows(
  epics: ReadonlyMap<string, BacklogEpic>,
  cards: Board["cards"],
  ids: readonly string[],
  collapse: EpicCollapseState,
  compact: boolean,
  filteredMatches: ReadonlySet<string> | undefined,
  readOnly: boolean,
): BacklogRows {
  const filtered = filteredMatches !== undefined;
  const ordinary: string[] = [];
  const children = new Map<string, string[]>();
  for (const id of ids) {
    const card = Object.hasOwn(cards, id) ? cards[id] : undefined;
    if (!card || card.archivedAt !== undefined) continue;
    const entry =
      card.epicId === undefined ? undefined : epics.get(card.epicId);
    if (entry?.epic.status !== "active") {
      ordinary.push(id);
      continue;
    }
    const group = children.get(entry.epic.id);
    if (group) group.push(id);
    else children.set(entry.epic.id, [id]);
  }

  const rows: BacklogRow[] = [];
  const cardIds: string[] = [];
  const completed: BacklogEpic[] = [];
  let hiddenCount = 0;
  const cardHeight = compact ? COMPACT_CARD_ROW_HEIGHT : CARD_ROW_HEIGHT;
  for (const [id, entry] of epics) {
    if (entry.epic.status === "completed") {
      if (!filtered) completed.push(entry);
      continue;
    }
    const group = children.get(id) ?? [];
    if (
      filtered &&
      group.length === 0 &&
      !entry.childIds.some((child) => filteredMatches?.has(child))
    )
      continue;
    const expanded = filtered || collapse.expanded.has(id);
    rows.push({
      kind: "epic",
      key: `epic:${id}`,
      entry,
      expanded,
      height: compact ? 100 : CARD_ROW_HEIGHT,
    });
    if (!expanded) {
      hiddenCount += group.length;
      continue;
    }
    for (const cardId of group) {
      rows.push({
        kind: "child",
        key: `card:${cardId}`,
        cardId,
        entry,
        height: cardHeight,
      });
      cardIds.push(cardId);
    }
    rows.push({
      kind: "epic-footer",
      key: `epic-footer:${id}`,
      entry,
      height: readOnly || filtered ? 48 : 92,
    });
  }
  rows.push({
    kind: "other",
    key: "other",
    count: ordinary.length,
    height: 36,
  });
  for (const cardId of ordinary) {
    rows.push({
      kind: "card",
      key: `card:${cardId}`,
      cardId,
      height: cardHeight,
    });
    cardIds.push(cardId);
  }
  if (completed.length > 0) {
    rows.push({
      kind: "completed",
      key: "completed",
      count: completed.length,
      height: 48,
    });
    if (collapse.completedOpen) {
      for (const entry of completed) {
        rows.push({
          kind: "epic",
          key: `epic:${entry.epic.id}`,
          entry,
          expanded: false,
          height: compact ? 100 : CARD_ROW_HEIGHT,
        });
      }
    }
  }
  if (!readOnly) rows.push({ kind: "footer", key: "footer", height: 48 });
  return { rows, cardIds, hiddenCount };
}
