import { useState } from "react";
import { Check, EllipsisVertical, Pencil, Plus, Trash2, X } from "lucide-react";

import { ConfirmDialog } from "@/components/board/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/Toast";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  LABEL_COLOR_DOT,
  LABEL_COLORS,
  type Label,
  type LabelColor,
  LIMITS,
} from "@/types/kanban";
import { LimitCounter } from "@/components/ui/limit-counter";

interface LabelPickerProps {
  /** All labels available on the active board. */
  labels: Label[];
  /** Label ids selected on the card being edited. */
  selected: string[];
  onToggle: (labelId: string) => void;
  onCreate: (name: string, color: LabelColor) => void;
  onRename: (labelId: string, name: string) => void;
  onRecolor: (labelId: string, color: LabelColor) => void;
  onDelete: (labelId: string) => void;
}

/**
 * Localized name per picker color — a typed dictionary instead of a template
 * string so `t()` still receives real `MessageKey`s (N-6).
 */
const LABEL_COLOR_KEYS = {
  red: "label.color.red",
  orange: "label.color.orange",
  yellow: "label.color.yellow",
  brown: "label.color.brown",
  green: "label.color.green",
  teal: "label.color.teal",
  cyan: "label.color.cyan",
  blue: "label.color.blue",
  indigo: "label.color.indigo",
  brand: "label.color.brand",
  fuchsia: "label.color.fuchsia",
  pink: "label.color.pink",
  slate: "label.color.slate",
  plain: "label.color.plain",
} satisfies Record<(typeof LABEL_COLORS)[number], MessageKey>;

/** Row of color swatches — used for the "new label" form and recolor menu. */
function ColorSwatches({
  value,
  onPick,
}: {
  value: LabelColor;
  onPick: (color: LabelColor) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {LABEL_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          title={t(LABEL_COLOR_KEYS[color])}
          aria-label={t(LABEL_COLOR_KEYS[color])}
          onClick={() => onPick(color)}
          className={cn(
            "flex h-5 w-5 items-center justify-center rounded-full transition-transform hover:scale-110",
            LABEL_COLOR_DOT[color],
            value === color &&
              "ring-2 ring-ring ring-offset-1 ring-offset-background",
          )}
        >
          {value === color ? (
            <Check className="h-3 w-3 text-white" strokeWidth={3} />
          ) : null}
        </button>
      ))}
    </div>
  );
}

/**
 * Label picker for a card.
 *
 * - Multi-select: click a chip to toggle it on/off.
 * - Inline creation: "New label" row with a name input + color swatches —
 *   the modern create-in-the-picker pattern (Trello/Notion style).
 * - Each chip has a ⋯ menu: rename (dialog), recolor (swatches), delete
 *   (confirmation — removed from every card).
 */
export function LabelPicker({
  labels,
  selected,
  onToggle,
  onCreate,
  onRename,
  onRecolor,
  onDelete,
}: LabelPickerProps) {
  const { t } = useI18n();
  const toast = useToast();

  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftColor, setDraftColor] = useState<LabelColor>("brand");

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const submitCreate = () => {
    const name = draftName.trim();
    if (!name) return;
    onCreate(name, draftColor);
    setDraftName("");
    setDraftColor("brand");
    setCreating(false);
  };

  const deletingLabel = labels.find((l) => l.id === deletingId);
  const renamingLabel = labels.find((l) => l.id === renamingId);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {labels.map((label) => {
          const isSelected = selected.includes(label.id);
          return (
            <div key={label.id} className="group/label flex items-center">
              <button
                type="button"
                aria-pressed={isSelected}
                onClick={() => {
                  if (!isSelected && selected.length >= LIMITS.labelsPerCard) {
                    toast.error(
                      t("limits.maxLabelsOnCard", {
                        limit: LIMITS.labelsPerCard,
                      }),
                    );
                    return;
                  }
                  onToggle(label.id);
                }}
                className={cn(
                  "inline-flex h-6 items-center gap-1.5 rounded-l-full border border-r-0 px-2 text-[11px] font-medium transition-colors",
                  isSelected
                    ? "border-foreground/40 bg-hover"
                    : "border-border hover:border-foreground/30 hover:bg-hover",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full",
                    LABEL_COLOR_DOT[label.color],
                  )}
                />
                {label.name}
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={t("label.rename")}
                    className={cn(
                      "flex h-6 w-5 items-center justify-center rounded-r-full border transition-colors",
                      isSelected
                        ? "border-foreground/40 bg-hover"
                        : "border-border hover:border-foreground/30 hover:bg-hover",
                    )}
                  >
                    <EllipsisVertical className="h-3 w-3 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48">
                  <DropdownMenuLabel>{label.name}</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => setRenamingId(label.id)}>
                    <Pencil className="h-4 w-4" />
                    {t("label.rename")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    {t("label.recolor")}
                  </div>
                  <div className="px-2 pb-1.5">
                    <ColorSwatches
                      value={label.color}
                      onPick={(color) => {
                        if (color !== label.color) onRecolor(label.id, color);
                      }}
                    />
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setDeletingId(label.id)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                    {t("label.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        })}
      </div>

      {creating ? (
        <div className="space-y-2 rounded-lg border border-border bg-background/40 p-2.5">
          <Input
            autoFocus
            name="label-create"
            value={draftName}
            maxLength={LIMITS.labelName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitCreate();
              if (e.key === "Escape") setCreating(false);
            }}
            placeholder={t("label.namePlaceholder")}
            className="h-8"
          />
          <LimitCounter
            length={draftName.length}
            limit={LIMITS.labelName}
            testId="label-create-limit"
          />
          <ColorSwatches value={draftColor} onPick={setDraftColor} />
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              onClick={submitCreate}
              disabled={!draftName.trim()}
            >
              {t("label.create")}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t("common.cancel")}
              onClick={() => setCreating(false)}
              className="h-7 w-7"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <button
                type="button"
                disabled={labels.length >= LIMITS.labelsPerBoard}
                onClick={() => setCreating(true)}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors enabled:hover:border-primary/40 enabled:hover:text-foreground disabled:opacity-50"
              >
                <Plus className="h-3 w-3" />
                {t("label.new")}
              </button>
            </span>
          </TooltipTrigger>
          {labels.length >= LIMITS.labelsPerBoard && (
            <TooltipContent>
              {t("limits.maxItems", { limit: LIMITS.labelsPerBoard })}
            </TooltipContent>
          )}
        </Tooltip>
      )}

      <Dialog
        open={renamingId !== null}
        onOpenChange={(open) => !open && setRenamingId(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("label.renameDialogTitle")}</DialogTitle>
          </DialogHeader>
          {/* The draft lives in the remounted form, not in a parent state
              cleared by `onOpenChange` (AGENT.md: reset by remount). */}
          {renamingLabel ? (
            <RenameLabelForm
              label={renamingLabel}
              onClose={() => setRenamingId(null)}
              onRename={onRename}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deletingId !== null}
        onOpenChange={(open) => !open && setDeletingId(null)}
        title={t("label.deleteTitle")}
        description={
          deletingLabel
            ? t("label.deleteDescription", { name: deletingLabel.name })
            : undefined
        }
        confirmLabel={t("label.delete")}
        destructive
        onConfirm={() => {
          if (deletingId) onDelete(deletingId);
          setDeletingId(null);
        }}
      />
    </div>
  );
}

interface RenameLabelFormProps {
  label: Label;
  onClose: () => void;
  onRename: (labelId: string, name: string) => void;
}

function RenameLabelForm({ label, onClose, onRename }: RenameLabelFormProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(label.name);

  const submit = () => {
    if (draft.trim()) onRename(label.id, draft.trim());
    onClose();
  };

  return (
    <>
      <Input
        autoFocus
        name="label-rename"
        value={draft}
        maxLength={LIMITS.labelName}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") onClose();
        }}
        onFocus={(e) => e.target.select()}
        placeholder={t("label.namePlaceholder")}
      />
      <LimitCounter
        length={draft.length}
        limit={LIMITS.labelName}
        testId="label-rename-limit"
      />
      <DialogFooter className="mt-2">
        <Button variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button onClick={submit}>{t("common.save")}</Button>
      </DialogFooter>
    </>
  );
}
