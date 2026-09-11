import { FileText, ListChecks, MessageSquare, Pencil, Plus, Settings2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { DueBadge } from "@/components/board/DueBadge";
import { LabelPicker } from "@/components/board/LabelPicker";
import {
  DueDatePickerContent,
} from "@/components/board/CardDueDate";
import { HighlightedText } from "@/components/ui/highlight";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/components/Toast";
import { formatDateOnly, useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { createId } from "@/utils/id";
import { useBoard } from "@/store/BoardContext";
import {
  LABEL_COLOR_CHIP,
  type Card,
  type Label,
  type LabelColor,
  LIMITS,
} from "@/types/kanban";

interface TableViewProps {
  /** Per-column card ids with a filter applied — overrides the stored
   *  order while the filter is active. */
  filteredCardIds?: Record<string, string[]>;
  /** True while a board filter is active (chooses the empty-state text). */
  isFiltering?: boolean;
  /** Search query highlighted inside titles. */
  highlight?: string;
  /** Fired on a row click — opens the card detail dialog. */
  onCardClick: (cardId: string) => void;
}

/** Sortable headers (TASK-14.1 п.7). */
type SortKey = "title" | "column" | "due" | "createdAt";

interface SortState {
  key: SortKey;
  dir: 1 | -1;
}

/** Optional columns beyond the four base ones (TASK-14.1 п.11). */
const OPTIONAL_COLUMNS = [
  "checklists",
  "description",
  "createdAt",
  "updatedAt",
  "activity",
] as const;
type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number];

const COLUMNS_STORAGE_KEY = "janosik-table-columns";

function readStoredColumns(): OptionalColumn[] {
  try {
    const stored = localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return parsed.filter((c): c is OptionalColumn =>
          (OPTIONAL_COLUMNS as readonly string[]).includes(c as string),
        );
      }
    }
  } catch {
    /* storage unavailable — the defaults apply */
  }
  return [];
}

/**
 * Table view (TASK-14.1) — a working surface, not just a projection:
 * sortable headers (asc → desc → board order), inline editing of the
 * due date / column / labels / title through the same undoable actions
 * the board uses (WIP limits respected, with the drag toast), a "+ card"
 * composer and show/hide column settings. The active filter applies
 * exactly as on the board.
 */
export function TableView({
  filteredCardIds,
  isFiltering = false,
  highlight,
  onCardClick,
}: TableViewProps) {
  const {
    board,
    addCard,
    updateCard,
    moveCard,
    toggleCardLabel,
    addLabel,
    renameLabel,
    setLabelColor,
    deleteLabel,
  } = useBoard();
  const { t, lang } = useI18n();
  const toast = useToast();

  const [sort, setSort] = useState<SortState | null>(null);
  const [visibleColumns, setVisibleColumns] =
    useState<OptionalColumn[]>(readStoredColumns);
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  // Persist the column choice next to the view/scale choices.
  useEffect(() => {
    try {
      localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(visibleColumns));
    } catch {
      /* storage unavailable — the choice only lasts the session */
    }
  }, [visibleColumns]);

  useEffect(() => {
    if (editingTitleId) titleInputRef.current?.focus();
  }, [editingTitleId]);

  if (!board) return null;

  const rows = board.columns.flatMap((column) => {
    const ids = filteredCardIds?.[column.id] ?? column.cardIds;
    return ids
      .map((id) => board.cards[id])
      .filter((card) => card !== undefined)
      .map((card) => ({ card, column }));
  });

  // Sort a copy — the stored board order is never touched (visual only).
  const sortedRows = (() => {
    if (!sort) return rows;
    const columnIndex = new Map(
      board.columns.map((col, index) => [col.id, index]),
    );
    const cmp = (a: (typeof rows)[number], b: (typeof rows)[number]) => {
      switch (sort.key) {
        case "title":
          return a.card.title.localeCompare(b.card.title, lang, { sensitivity: "base" });
        case "column":
          return (columnIndex.get(a.column.id) ?? 0) - (columnIndex.get(b.column.id) ?? 0);
        case "due": {
          // Undated cards always float to the bottom (like sortColumn).
          const aDue = typeof a.card.dueDate === "number" ? a.card.dueDate : null;
          const bDue = typeof b.card.dueDate === "number" ? b.card.dueDate : null;
          if (aDue === null && bDue === null) return 0;
          if (aDue === null) return 1;
          if (bDue === null) return -1;
          return aDue - bDue;
        }
        case "createdAt":
          return a.card.createdAt - b.card.createdAt;
      }
    };
    return [...rows].sort((a, b) => cmp(a, b) * sort.dir);
  })();

  const cycleSort = (key: SortKey) => {
    setSort((prev) => {
      if (prev?.key !== key) return { key, dir: 1 };
      if (prev.dir === 1) return { key, dir: -1 };
      return null; // third click resets to the board order
    });
  };

  const labelsOf = (labelIds: string[]): Label[] =>
    labelIds
      .map((labelId) => board.labels.find((l) => l.id === labelId))
      .filter((l): l is Label => Boolean(l));

  const checklistProgress = (card: Card) => {
    const items = (card.checklists ?? []).flatMap((c) => c.items);
    return { done: items.filter((i) => i.done).length, total: items.length };
  };

  const startTitleEdit = (card: Card) => {
    setEditingTitleId(card.id);
    setTitleDraft(card.title);
  };

  const submitTitleEdit = (cardId: string) => {
    const trimmed = titleDraft.trim();
    setEditingTitleId(null);
    if (trimmed && trimmed !== board.cards[cardId]?.title) {
      updateCard(cardId, { title: trimmed });
    }
  };

  const cancelTitleEdit = () => setEditingTitleId(null);

  const handleCreateLabel = (cardId: string) => (name: string, color: LabelColor) => {
    const label = { id: createId(), name, color };
    addLabel(label);
    toggleCardLabel(cardId, label.id);
  };

  const moveToColumn = (card: Card, fromColumnId: string, toColumnId: string) => {
    if (toColumnId === fromColumnId) return;
    const target = board.columns.find((col) => col.id === toColumnId);
    if (!target) return;
    // WIP limit respected on inline moves too — same toast as board drag.
    if (
      target.wipLimit !== undefined &&
      target.cardIds.length >= target.wipLimit
    ) {
      toast.error(
        t("toast.wipLimitBlocked", {
          title: target.title,
          limit: target.wipLimit,
        }),
      );
      return;
    }
    moveCard(card.id, fromColumnId, toColumnId, target.cardIds.length);
  };

  const optionalCount = visibleColumns.length;

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm">
      {/* Toolbar: + card composer and the column settings (TASK-14.1 п.10/11). */}
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" className="h-7 gap-1 px-2 text-xs" data-testid="table-add-card">
              <Plus className="h-3.5 w-3.5" />
              {t("composer.add")}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-2">
            <TableCardComposer
              columns={board.columns.map((col) => ({ id: col.id, title: col.title }))}
              onSubmit={(columnId, title) => addCard(columnId, title)}
            />
          </PopoverContent>
        </Popover>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-7 gap-1 px-2 text-xs"
              aria-label={t("view.table.columnsSettings")}
              data-testid="table-columns-settings"
            >
              <Settings2 className="h-3.5 w-3.5" />
              {t("view.table.columnsSettings")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{t("view.table.columnsSettings")}</DropdownMenuLabel>
            {OPTIONAL_COLUMNS.map((column) => (
              <DropdownMenuCheckboxItem
                key={column}
                checked={visibleColumns.includes(column)}
                onCheckedChange={() =>
                  setVisibleColumns((prev) =>
                    prev.includes(column)
                      ? prev.filter((c) => c !== column)
                      : [...prev, column],
                  )
                }
                onSelect={(event) => event.preventDefault()}
              >
                {t(`view.table.${column}`)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex-1 overflow-y-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border/60">
              <SortHeader
                label={t("view.table.title")}
                sortKey="title"
                sort={sort}
                onCycle={cycleSort}
              />
              <SortHeader
                label={t("view.table.column")}
                sortKey="column"
                sort={sort}
                onCycle={cycleSort}
                className="w-40"
              />
              <SortHeader
                label={t("dueDate.label")}
                sortKey="due"
                sort={sort}
                onCycle={cycleSort}
                className="w-48"
              />
              <th scope="col" className="w-44 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("view.table.labels")}
              </th>
              {visibleColumns.includes("checklists") ? (
                <th scope="col" className="w-24 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("view.table.checklists")}
                </th>
              ) : null}
              {visibleColumns.includes("description") ? (
                <th scope="col" className="w-16 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("view.table.description")}
                </th>
              ) : null}
              {visibleColumns.includes("createdAt") ? (
                <th scope="col" className="w-28 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("view.table.createdAt")}
                </th>
              ) : null}
              {visibleColumns.includes("updatedAt") ? (
                <th scope="col" className="w-28 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("view.table.updatedAt")}
                </th>
              ) : null}
              {visibleColumns.includes("activity") ? (
                <th scope="col" className="w-20 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("view.table.activity")}
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={4 + optionalCount} className="px-3 py-8 text-center text-muted-foreground">
                  {isFiltering ? t("filter.noMatch") : t("view.table.empty")}
                </td>
              </tr>
            ) : (
              sortedRows.map(({ card, column }) => (
                <tr
                  key={card.id}
                  onClick={() => onCardClick(card.id)}
                  data-testid="table-row"
                  className="cursor-pointer border-b border-border/40 transition-colors last:border-b-0 hover:bg-muted/40"
                >
                  <td className="max-w-0 px-3 py-2">
                    {editingTitleId === card.id ? (
                      <Input
                        ref={titleInputRef}
                        value={titleDraft}
                        maxLength={LIMITS.cardTitle}
                        aria-label={t("view.table.rename")}
                        data-testid="table-title-input"
                        onClick={(event) => event.stopPropagation()}
                        onChange={(e) => setTitleDraft(e.target.value)}
                        onBlur={() => submitTitleEdit(card.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") submitTitleEdit(card.id);
                          if (e.key === "Escape") cancelTitleEdit();
                        }}
                        className="h-7 text-sm"
                      />
                    ) : (
                      <span className="group/title flex items-center gap-1">
                        <span
                          onDoubleClick={(event) => {
                            event.stopPropagation();
                            startTitleEdit(card);
                          }}
                          className="min-w-0 flex-1 truncate font-medium text-foreground/90"
                        >
                          <HighlightedText text={card.title} query={highlight ?? ""} />
                        </span>
                        <button
                          type="button"
                          aria-label={t("view.table.rename")}
                          data-testid="table-title-edit"
                          onClick={(event) => {
                            event.stopPropagation();
                            startTitleEdit(card);
                          }}
                          className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/title:opacity-100"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          data-testid="table-column-cell"
                          title={t("view.table.moveHint")}
                          className="inline-flex max-w-full items-center truncate rounded-md bg-muted/50 px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          {column.title}
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuLabel>{t("view.table.column")}</DropdownMenuLabel>
                        {board.columns.map((col) => (
                          <DropdownMenuItem
                            key={col.id}
                            disabled={col.id === column.id}
                            onSelect={() => moveToColumn(card, column.id, col.id)}
                          >
                            {col.title}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                  <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          data-testid="table-due-cell"
                          className="rounded transition-opacity hover:opacity-80"
                          aria-label={t("dueDate.label")}
                        >
                          {typeof card.dueDate === "number" ? (
                            <DueBadge dueDate={card.dueDate} />
                          ) : (
                            <span className="text-xs text-muted-foreground/60">—</span>
                          )}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="relative w-auto p-3">
                        <DueDatePickerContent cardId={card.id} dueDate={card.dueDate} />
                      </PopoverContent>
                    </Popover>
                  </td>
                  <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          data-testid="table-labels-cell"
                          className="max-w-44"
                          aria-label={t("view.table.labels")}
                        >
                          {card.labelIds.length > 0 ? (
                            <span className="flex flex-wrap gap-1">
                              {labelsOf(card.labelIds).map((label) => (
                                <span
                                  key={label.id}
                                  className={
                                    "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
                                    LABEL_COLOR_CHIP[label.color]
                                  }
                                >
                                  <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
                                  {label.name}
                                </span>
                              ))}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground/60">—</span>
                          )}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-64 p-3">
                        <LabelPicker
                          labels={board.labels}
                          selected={card.labelIds}
                          onToggle={(labelId) => toggleCardLabel(card.id, labelId)}
                          onCreate={handleCreateLabel(card.id)}
                          onRename={renameLabel}
                          onRecolor={setLabelColor}
                          onDelete={deleteLabel}
                        />
                      </PopoverContent>
                    </Popover>
                  </td>
                  {visibleColumns.includes("checklists") ? (
                    <td className="px-3 py-2">
                      {(() => {
                        const { done, total } = checklistProgress(card);
                        return total > 0 ? (
                          <span
                            data-testid="table-checklist"
                            title={t("checklist.badgeTooltip", { done, total })}
                            className="inline-flex items-center gap-1 rounded-md bg-muted/50 px-1.5 py-0.5 text-[11px] text-muted-foreground"
                          >
                            <ListChecks className="h-3 w-3" aria-hidden />
                            {done}/{total}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/60">—</span>
                        );
                      })()}
                    </td>
                  ) : null}
                  {visibleColumns.includes("description") ? (
                    <td className="px-3 py-2">
                      {card.description ? (
                        <FileText
                          data-testid="table-description"
                          className="h-3.5 w-3.5 text-muted-foreground"
                          aria-label={t("view.table.description")}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground/60">—</span>
                      )}
                    </td>
                  ) : null}
                  {visibleColumns.includes("createdAt") ? (
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {formatDateOnly(card.createdAt, lang)}
                    </td>
                  ) : null}
                  {visibleColumns.includes("updatedAt") ? (
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {formatDateOnly(card.updatedAt, lang)}
                    </td>
                  ) : null}
                  {visibleColumns.includes("activity") ? (
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <MessageSquare className="h-3 w-3" aria-hidden />
                        {card.activity?.length ?? 0}
                      </span>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Table header cell with the asc → desc → reset click cycle. */
function SortHeader({
  label,
  sortKey,
  sort,
  onCycle,
  className,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState | null;
  onCycle: (key: SortKey) => void;
  className?: string;
}) {
  const isSorted = sort?.key === sortKey;
  return (
    <th scope="col" className={cn("px-3 py-2 text-left", className)}>
      <button
        type="button"
        data-testid={`table-sort-${sortKey}`}
        aria-sort={isSorted ? (sort?.dir === 1 ? "ascending" : "descending") : "none"}
        onClick={() => onCycle(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide transition-colors hover:text-foreground",
          isSorted ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        <span aria-hidden className={cn("text-[10px]", !isSorted && "opacity-0")}>
          {sort?.dir === 1 ? "▲" : "▼"}
        </span>
      </button>
    </th>
  );
}

/** "+ card" composer body: title input + column chooser (TASK-14.1 п.10). */
function TableCardComposer({
  columns,
  onSubmit,
}: {
  columns: { id: string; title: string }[];
  onSubmit: (columnId: string, title: string) => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [columnId, setColumnId] = useState(columns[0]?.id ?? "");

  const selected = columns.find((col) => col.id === columnId);
  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed || !columnId) return;
    onSubmit(columnId, trimmed);
    setTitle("");
  };

  return (
    <div className="space-y-2">
      <Input
        autoFocus
        value={title}
        maxLength={LIMITS.cardTitle}
        data-testid="table-composer-input"
        placeholder={t("composer.placeholder")}
        aria-label={t("composer.add")}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        className="h-8 text-sm"
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 w-full justify-start text-xs" data-testid="table-composer-column">
            {selected?.title ?? "—"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {columns.map((col) => (
            <DropdownMenuItem key={col.id} onSelect={() => setColumnId(col.id)}>
              {col.title}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button size="sm" className="h-7 w-full text-xs" disabled={!title.trim()} onClick={submit}>
        {t("composer.submit")}
      </Button>
    </div>
  );
}
