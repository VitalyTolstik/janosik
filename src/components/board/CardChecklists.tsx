import { useRef, useState } from "react";
import {
  Check,
  ListTodo,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/board/ConfirmDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { useBoard } from "@/store/BoardContext";
import type { Checklist } from "@/types/kanban";

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
}

export function CardChecklists({ cardId, checklists }: CardChecklistsProps) {
  const { t } = useI18n();
  const {
    addChecklist,
    renameChecklist,
    deleteChecklist,
    addChecklistItem,
    toggleChecklistItem,
    renameChecklistItem,
    deleteChecklistItem,
  } = useBoard();
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
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

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          {t("checklist.sectionLabel")}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => addChecklist(cardId, t("checklist.defaultTitle"))}
        >
          <Plus className="h-3.5 w-3.5" />
          {t("checklist.add")}
        </Button>
      </div>

      {checklists.map((checklist) => (
        <ChecklistCard
          key={checklist.id}
          checklist={checklist}
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
    </div>
  );
}

interface ChecklistCardProps {
  checklist: Checklist;
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
  const done = checklist.items.filter((item) => item.done).length;
  const total = checklist.items.length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="rounded-lg border border-border/70 bg-background/40 p-3">
      <div className="flex items-center gap-2">
        {editingTitle ? (
          <TitleInput
            defaultValue={checklist.title}
            onDraft={onEditTitle}
            onCommit={onCommitTitle}
            onCancel={onCancelTitle}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {checklist.title}
          </span>
        )}
        {total > 0 ? (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {t("checklist.progress", { count: total, done, total })}
          </span>
        ) : null}
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
      </div>

      {total > 0 ? (
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

      <ul className="mt-2 space-y-0.5">
        {checklist.items.map((item) => (
          <li key={item.id} className="group/item flex items-center gap-2">
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
            {editingItemId === item.id ? (
              <TitleInput
                defaultValue={item.text}
                onDraft={(draft) => onEditItem(item.id, draft)}
                onCommit={() => onCommitItem(item.id)}
                onCancel={onCancelItem}
              />
            ) : (
              <span
                onDoubleClick={() => onEditItem(item.id, item.text)}
                className={cn(
                  "min-w-0 flex-1 cursor-text break-words text-sm",
                  item.done && "text-muted-foreground line-through",
                )}
              >
                {item.text}
              </span>
            )}
            <button
              type="button"
              onClick={() => onDeleteItem(item.id)}
              aria-label={t("checklist.itemDelete")}
              className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover/item:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>

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
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          placeholder={t("checklist.itemPlaceholder")}
          className="h-8 border-none bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
        />
      </form>

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
  onDraft,
  onCommit,
  onCancel,
}: TitleInputProps) {
  return (
    <Input
      autoFocus
      defaultValue={defaultValue}
      onChange={(e) => onDraft(e.target.value)}
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
  );
}
