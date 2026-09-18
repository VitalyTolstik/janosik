import { useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  ListTodo,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CollapsibleSection } from "@/components/board/CollapsibleSection";
import { ConfirmDialog } from "@/components/board/ConfirmDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { useBoardActions } from "@/store/BoardContext";
import type { Checklist } from "@janosik/shared";
import { LIMITS } from "@janosik/shared";
import { LimitCounter } from "@/components/ui/limit-counter";

/**
 * Subtask checklists inside the card dialog (TASK-3).
 *
 * Each checklist shows a progress bar with a "done/total" counter, a
 * rename/delete menu, todo rows (click toggles, double-click renames) and an
 * inline composer. All edits go through the board reducer, so undo/redo and
 * persistence cover them like any other card change.
 */

interface CardChecklistsProps {
  cardId: string;
  checklists: Checklist[];
  /** VIEWER mode (TASK-35): progress and items only, nothing interactive. */
  readOnly?: boolean;
}

export function CardChecklists({
  cardId,
  checklists,
  readOnly = false,
}: CardChecklistsProps) {
  const { t } = useI18n();
  const {
    addChecklist,
    renameChecklist,
    deleteChecklist,
    addChecklistItem,
    toggleChecklistItem,
    renameChecklistItem,
    deleteChecklistItem,
  } = useBoardActions();
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  // Adding from a collapsed header must reveal the new checklist.
  const [expanded, setExpanded] = useState(true);
  const draftRef = useRef("");

  const commitTitle = (checklistId: string) => {
    const title = draftRef.current.trim();
    if (title) renameChecklist(cardId, checklistId, title);
    setEditingTitleId(null);
  };

  const commitItem = (checklistId: string, itemId: string) => {
    const text = draftRef.current.trim();
    if (text) renameChecklistItem(cardId, checklistId, itemId, text);
    setEditingItemId(null);
  };

  // Overall progress for the collapsed header badge (Jira-style "3/7").
  const totalItems = checklists.reduce(
    (sum, checklist) => sum + checklist.items.length,
    0,
  );
  const doneItems = checklists.reduce(
    (sum, checklist) =>
      sum + checklist.items.filter((item) => item.done).length,
    0,
  );

  return (
    <CollapsibleSection
      title={t("checklist.sectionLabel")}
      badge={totalItems > 0 ? `${doneItems}/${totalItems}` : undefined}
      testId="checklists-toggle"
      expanded={expanded}
      onExpandedChange={setExpanded}
      contentClassName="mt-2 space-y-2"
      action={
        /* Capped at LIMITS.checklistsPerCard — the disabled button
            explains itself through the tooltip. Hidden for VIEWER. */
        readOnly ? undefined : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                  disabled={checklists.length >= LIMITS.checklistsPerCard}
                  onClick={() => {
                    setExpanded(true);
                    addChecklist(cardId, t("checklist.defaultTitle"));
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("checklist.add")}
                </Button>
              </span>
            </TooltipTrigger>
            {checklists.length >= LIMITS.checklistsPerCard && (
              <TooltipContent>
                {t("limits.maxItems", { limit: LIMITS.checklistsPerCard })}
              </TooltipContent>
            )}
          </Tooltip>
        )
      }
    >
      {checklists.map((checklist) => (
        <ChecklistCard
          key={checklist.id}
          checklist={checklist}
          readOnly={readOnly}
          editingTitle={editingTitleId === checklist.id}
          editingItemId={editingItemId}
          onEditTitle={(draft) => {
            draftRef.current = draft;
            setEditingTitleId(checklist.id);
          }}
          onCommitTitle={() => commitTitle(checklist.id)}
          onCancelTitle={() => setEditingTitleId(null)}
          onRename={(title) => renameChecklist(cardId, checklist.id, title)}
          onDelete={() => deleteChecklist(cardId, checklist.id)}
          onAddItem={(text) => addChecklistItem(cardId, checklist.id, text)}
          onToggleItem={(itemId) =>
            toggleChecklistItem(cardId, checklist.id, itemId)
          }
          onEditItem={(itemId, draft) => {
            draftRef.current = draft;
            setEditingItemId(itemId);
          }}
          onCommitItem={(itemId) => commitItem(checklist.id, itemId)}
          onCancelItem={() => setEditingItemId(null)}
          onDeleteItem={(itemId) =>
            deleteChecklistItem(cardId, checklist.id, itemId)
          }
        />
      ))}
    </CollapsibleSection>
  );
}

interface ChecklistCardProps {
  checklist: Checklist;
  /** VIEWER mode (TASK-35): no title menu, no item editors. */
  readOnly?: boolean;
  editingTitle: boolean;
  editingItemId: string | null;
  onEditTitle: (draft: string) => void;
  onCommitTitle: () => void;
  onCancelTitle: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onAddItem: (text: string) => void;
  onToggleItem: (itemId: string) => void;
  onEditItem: (itemId: string, draft: string) => void;
  onCommitItem: (itemId: string) => void;
  onCancelItem: () => void;
  onDeleteItem: (itemId: string) => void;
}

function ChecklistCard({
  checklist,
  readOnly = false,
  editingTitle,
  editingItemId,
  onEditTitle,
  onCommitTitle,
  onCancelTitle,
  onDelete,
  onAddItem,
  onToggleItem,
  onEditItem,
  onCommitItem,
  onCancelItem,
  onDeleteItem,
}: ChecklistCardProps) {
  const { t } = useI18n();
  const [newItem, setNewItem] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  // One checklist folds on its own: with several lists (some already
  // finished) the section stays scannable without touching the others.
  const [expanded, setExpanded] = useState(true);
  const done = checklist.items.filter((item) => item.done).length;
  const total = checklist.items.length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="rounded-lg border border-border/70 bg-background/40 p-3">
      <div className="flex items-center gap-2">
        {editingTitle ? (
          <TitleInput
            defaultValue={checklist.title}
            maxLength={LIMITS.checklistTitle}
            onDraft={onEditTitle}
            onCommit={onCommitTitle}
            onCancel={onCancelTitle}
          />
        ) : (
          <button
            type="button"
            aria-expanded={expanded}
            data-testid={`checklist-toggle-${checklist.id}`}
            onClick={() => setExpanded((value) => !value)}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded text-left hover:text-foreground"
          >
            <ChevronRight
              aria-hidden="true"
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                expanded && "rotate-90",
              )}
            />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {checklist.title}
            </span>
          </button>
        )}
        {total > 0 ? (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {t("checklist.progress", { count: total, done, total })}
          </span>
        ) : null}
        {readOnly ? null : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                aria-label={t("checklist.menuLabel")}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>{t("checklist.menuLabel")}</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => onEditTitle(checklist.title)}>
                <Pencil className="h-3.5 w-3.5" />
                {t("checklist.rename")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t("checklist.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {expanded && total > 0 ? (
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : null}

      {/* Eight rows fit the cap (TASK-44); a longer checklist scrolls
          inside instead of stretching the whole card dialog. */}
      {expanded ? (
        <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto pr-1">
          {checklist.items.map((item) => (
            <li key={item.id} className="group/item flex items-center gap-2">
              {readOnly ? (
                <span
                  aria-hidden
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    item.done
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border/80 bg-background",
                  )}
                >
                  {item.done ? <Check className="h-3 w-3" /> : null}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onToggleItem(item.id)}
                  aria-pressed={item.done}
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                    item.done
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border/80 bg-background hover:border-primary/60",
                  )}
                >
                  {item.done ? <Check className="h-3 w-3" /> : null}
                </button>
              )}
              {editingItemId === item.id ? (
                <TitleInput
                  defaultValue={item.text}
                  maxLength={LIMITS.checklistItem}
                  onDraft={(draft) => onEditItem(item.id, draft)}
                  onCommit={() => onCommitItem(item.id)}
                  onCancel={onCancelItem}
                />
              ) : (
                <span
                  onDoubleClick={
                    readOnly ? undefined : () => onEditItem(item.id, item.text)
                  }
                  className={cn(
                    "min-w-0 flex-1 break-words text-sm",
                    !readOnly && "cursor-text",
                    item.done && "text-muted-foreground line-through",
                  )}
                >
                  {item.text}
                </span>
              )}
              {readOnly ? null : (
                <button
                  type="button"
                  onClick={() => onDeleteItem(item.id)}
                  aria-label={t("checklist.itemDelete")}
                  className="no-hover:opacity-100 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover/item:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {expanded && !readOnly ? (
        <form
          className="mt-2 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const text = newItem.trim();
            if (!text) return;
            onAddItem(text);
            setNewItem("");
          }}
        >
          <ListTodo className="h-4 w-4 shrink-0 text-muted-foreground/60" />
          <Input
            name="checklist-new-item"
            value={newItem}
            maxLength={LIMITS.checklistItem}
            disabled={checklist.items.length >= LIMITS.itemsPerChecklist}
            onChange={(e) => setNewItem(e.target.value)}
            placeholder={t("checklist.itemPlaceholder")}
            aria-label={t("checklist.itemPlaceholder")}
            className="h-8 border-none bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
          />
          <LimitCounter
            length={newItem.length}
            limit={LIMITS.checklistItem}
            position="below"
            className="left-6"
            testId="checklist-item-add-limit"
          />
        </form>
      ) : null}

      {/* Deleting a checklist wipes its items — ask first (same pattern as
          card/column/label deletion). */}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("checklist.deleteTitle")}
        description={t("checklist.deleteDescription", {
          count: total,
          title: checklist.title,
        })}
        confirmLabel={t("checklist.deleteConfirm")}
        destructive
        onConfirm={onDelete}
      />
    </div>
  );
}

interface TitleInputProps {
  defaultValue: string;
  maxLength: number;
  onDraft: (draft: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

/**
 * Shared inline editor for checklist and item titles: the current draft is
 * reported back through `onDraft` (so the parent can re-commit it), Enter
 * commits, Escape cancels and blur commits — mirroring the column rename UX.
 */
function TitleInput({
  defaultValue,
  maxLength,
  onDraft,
  onCommit,
  onCancel,
}: TitleInputProps) {
  // Uncontrolled input; only the length is mirrored for the limit counter.
  const [length, setLength] = useState(defaultValue.length);
  return (
    <span className="relative min-w-0 flex-1">
      <Input
        autoFocus
        name="checklist-item-edit"
        defaultValue={defaultValue}
        maxLength={maxLength}
        onChange={(e) => {
          setLength(e.target.value.length);
          onDraft(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCommit();
          } else if (e.key === "Escape") {
            onCancel();
          }
        }}
        onBlur={onCommit}
        className="h-7 text-sm"
      />
      <LimitCounter
        length={length}
        limit={maxLength}
        position="below"
        testId="checklist-title-limit"
      />
    </span>
  );
}
