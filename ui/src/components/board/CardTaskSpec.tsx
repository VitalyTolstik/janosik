import { useEffect, useRef, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import { CollapsibleSection } from "@/components/board/CollapsibleSection";
import { ConfirmDialog } from "@/components/board/ConfirmDialog";
import { useToast } from "@/components/Toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n";
import { useBoardActions } from "@/store/BoardContext";
import { LIMITS } from "@janosik/shared";

type SpecError = "tooMany" | "tooLong";
type SpecErrors = { criteria?: SpecError; done?: SpecError };

/** First validation failure for one staged list, or null when it fits. */
function listError(items: string[]): SpecError | null {
  if (items.length > LIMITS.taskSpecItems) return "tooMany";
  if (items.some((item) => item.length > LIMITS.taskSpecItem)) return "tooLong";
  return null;
}

/**
 * The card's machine-readable task contract (TASK-157): acceptance criteria
 * and definition of done, set by an agent over MCP/commands or by a human
 * here. Editing is explicit — the lists are staged until Save, so a typo
 * never becomes the contract an agent reads.
 */
export function CardTaskSpec({
  cardId,
  acceptanceCriteria,
  definitionOfDone,
  canEdit = false,
  onEditingChange,
}: {
  cardId: string;
  acceptanceCriteria?: string[];
  definitionOfDone?: string[];
  /** ADMIN/MEMBER and a writable card (TASK-177.4 decision 1). */
  canEdit?: boolean;
  /**
   * TASK-177.4 UX fix: the card dialog needs to know an inline editor owns
   * Escape before Radix's document-capture listener closes the whole dialog.
   */
  onEditingChange?: (editing: boolean) => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const { setCardTaskSpec } = useBoardActions();
  const criteria = acceptanceCriteria ?? [];
  const done = definitionOfDone ?? [];
  const hasSpec = criteria.length > 0 || done.length > 0;

  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [criteriaDraft, setCriteriaDraft] = useState("");
  const [doneDraft, setDoneDraft] = useState("");
  const [errors, setErrors] = useState<SpecErrors>({});
  const [clearConfirm, setClearConfirm] = useState(false);
  const criteriaRef = useRef<HTMLTextAreaElement>(null);
  const doneRef = useRef<HTMLTextAreaElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const clearButtonRef = useRef<HTMLButtonElement>(null);
  const clearConfirmed = useRef(false);
  const clearOrigin = useRef<"header" | "save">("header");
  const focusErrorRef = useRef<"criteria" | "done" | null>(null);
  const returnFocus = useRef(false);
  // The lists as they were when the editor opened. A field the human did not
  // touch is never sent, even if its prop moved concurrently underneath.
  const initialCriteria = useRef<string[]>([]);
  const initialDone = useRef<string[]>([]);

  const hintId = `card-task-spec-hint-${cardId}`;
  const criteriaErrorId = `card-task-spec-criteria-error-${cardId}`;
  const doneErrorId = `card-task-spec-done-error-${cardId}`;

  useEffect(() => {
    if (editing) criteriaRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!editing && returnFocus.current) {
      returnFocus.current = false;
      editButtonRef.current?.focus();
    }
  }, [editing]);

  useEffect(() => {
    const target = focusErrorRef.current;
    if (target === null) return;
    focusErrorRef.current = null;
    (target === "criteria" ? criteriaRef : doneRef).current?.focus();
  }, [errors]);

  // The dialog keys this component by card id; an unmount (card switch or
  // dialog close) must release the Escape guard even if the draft was open.
  useEffect(() => {
    return () => onEditingChange?.(false);
  }, [onEditingChange]);

  // The dialog can swap cards without unmounting, so CardDialog keys this
  // component by card id; local drafts therefore never cross cards.
  if (!hasSpec && !canEdit) return null;

  const startEditing = () => {
    initialCriteria.current = [...criteria];
    initialDone.current = [...done];
    setCriteriaDraft(criteria.join("\n"));
    setDoneDraft(done.join("\n"));
    setErrors({});
    setExpanded(true);
    setEditing(true);
    onEditingChange?.(true);
  };

  const closeEditor = () => {
    returnFocus.current = true;
    setEditing(false);
    setErrors({});
    onEditingChange?.(false);
  };

  const parse = (value: string): string[] =>
    value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter((item) => item !== "");

  const errorMessage = (error: SpecError): string =>
    error === "tooMany"
      ? t("card.taskSpec.tooMany", { count: LIMITS.taskSpecItems })
      : t("card.taskSpec.tooLong", { length: LIMITS.taskSpecItem });

  const sameList = (left: string[], right: string[]): boolean =>
    left.length === right.length &&
    left.every((item, index) => item === right[index]);

  const save = () => {
    const nextCriteria = parse(criteriaDraft);
    const nextDone = parse(doneDraft);
    const nextErrors: SpecErrors = {};
    const criteriaError = listError(nextCriteria);
    const doneError = listError(nextDone);
    if (criteriaError !== null) nextErrors.criteria = criteriaError;
    if (doneError !== null) nextErrors.done = doneError;
    if (nextErrors.criteria !== undefined || nextErrors.done !== undefined) {
      focusErrorRef.current =
        nextErrors.criteria !== undefined ? "criteria" : "done";
      setErrors(nextErrors);
      return;
    }

    // A concurrent agent may have rewritten one list while this editor was
    // open. The draft is a snapshot; send only the list the human actually
    // changed so an untouched stale copy never wins over the fresh prop.
    const changedCriteria = sameList(nextCriteria, initialCriteria.current)
      ? undefined
      : nextCriteria;
    const changedDone = sameList(nextDone, initialDone.current)
      ? undefined
      : nextDone;
    if (changedCriteria === undefined && changedDone === undefined) {
      closeEditor();
      return;
    }

    // Emptying both fields is the same destructive intent as Clear.
    if (hasSpec && nextCriteria.length === 0 && nextDone.length === 0) {
      clearOrigin.current = "save";
      setClearConfirm(true);
      return;
    }

    setCardTaskSpec(cardId, {
      ...(changedCriteria !== undefined
        ? { acceptanceCriteria: changedCriteria }
        : {}),
      ...(changedDone !== undefined ? { definitionOfDone: changedDone } : {}),
    });
    closeEditor();
  };

  const clear = () => {
    setCardTaskSpec(cardId, {
      acceptanceCriteria: [],
      definitionOfDone: [],
    });
    setEditing(false);
    setErrors({});
    onEditingChange?.(false);
  };

  const handleClearClosed = () => {
    const confirmed = clearConfirmed.current;
    const origin = clearOrigin.current;
    clearConfirmed.current = false;
    clearOrigin.current = "header";
    if (confirmed) {
      editButtonRef.current?.focus();
      return;
    }
    // Cancel returns to the control that opened the confirmation.
    if (origin === "save") {
      criteriaRef.current?.focus();
    } else {
      clearButtonRef.current?.focus();
    }
  };

  const action =
    canEdit && !editing ? (
      <div className="flex items-center gap-1">
        {hasSpec ? (
          <Button
            ref={clearButtonRef}
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1 px-2 text-xs max-lg:h-11 no-hover:min-h-11"
            data-testid="card-task-spec-clear"
            onClick={() => {
              clearOrigin.current = "header";
              setClearConfirm(true);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            {t("card.taskSpec.clear")}
          </Button>
        ) : null}
        <Button
          ref={editButtonRef}
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1 px-2 text-xs max-lg:h-11 no-hover:min-h-11"
          data-testid="card-task-spec-edit"
          onClick={startEditing}
        >
          {hasSpec ? (
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {hasSpec ? t("card.taskSpec.edit") : t("card.taskSpec.add")}
        </Button>
      </div>
    ) : undefined;

  return (
    <>
      <CollapsibleSection
        title={t("card.taskSpec.title")}
        badge={criteria.length + done.length || undefined}
        testId="card-task-spec"
        expanded={expanded}
        onExpandedChange={(next) => {
          if (!next && editing) {
            toast.info(t("card.taskSpec.finishEditing"));
            return;
          }
          setExpanded(next);
        }}
        action={action}
        contentClassName="mt-1.5 space-y-2"
      >
        {editing ? (
          <form
            noValidate
            className="space-y-2"
            data-testid="card-task-spec-form"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <div className="space-y-1">
              <label
                htmlFor={`card-task-spec-criteria-${cardId}`}
                className="text-xs font-medium text-muted-foreground"
              >
                {t("card.taskSpec.acceptanceCriteria")}
              </label>
              <Textarea
                id={`card-task-spec-criteria-${cardId}`}
                ref={criteriaRef}
                value={criteriaDraft}
                onChange={(event) => {
                  setCriteriaDraft(event.target.value);
                  setErrors({});
                }}
                rows={3}
                aria-invalid={errors.criteria !== undefined || undefined}
                aria-describedby={
                  errors.criteria !== undefined
                    ? `${hintId} ${criteriaErrorId}`
                    : hintId
                }
                data-testid="card-task-spec-criteria-input"
              />
              {errors.criteria !== undefined ? (
                <p
                  id={criteriaErrorId}
                  role="alert"
                  data-testid="card-task-spec-error"
                  className="text-xs text-destructive"
                >
                  {errorMessage(errors.criteria)}
                </p>
              ) : null}
            </div>
            <div className="space-y-1">
              <label
                htmlFor={`card-task-spec-done-${cardId}`}
                className="text-xs font-medium text-muted-foreground"
              >
                {t("card.taskSpec.definitionOfDone")}
              </label>
              <Textarea
                id={`card-task-spec-done-${cardId}`}
                ref={doneRef}
                value={doneDraft}
                onChange={(event) => {
                  setDoneDraft(event.target.value);
                  setErrors({});
                }}
                rows={3}
                aria-invalid={errors.done !== undefined || undefined}
                aria-describedby={
                  errors.done !== undefined
                    ? `${hintId} ${doneErrorId}`
                    : hintId
                }
                data-testid="card-task-spec-done-input"
              />
              {errors.done !== undefined ? (
                <p
                  id={doneErrorId}
                  role="alert"
                  data-testid="card-task-spec-error"
                  className="text-xs text-destructive"
                >
                  {errorMessage(errors.done)}
                </p>
              ) : null}
            </div>
            <p
              id={hintId}
              className="text-[11px] leading-snug text-muted-foreground"
            >
              {t("card.taskSpec.hint", {
                count: LIMITS.taskSpecItems,
                length: LIMITS.taskSpecItem,
              })}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="max-lg:h-11 no-hover:min-h-11"
                data-testid="card-task-spec-cancel"
                onClick={closeEditor}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                size="sm"
                className="max-lg:h-11 no-hover:min-h-11"
                data-testid="card-task-spec-save"
              >
                {t("card.taskSpec.save")}
              </Button>
            </div>
          </form>
        ) : hasSpec ? (
          <>
            {criteria.length > 0 ? (
              <TaskSpecList
                label={t("card.taskSpec.acceptanceCriteria")}
                items={criteria}
                testId="card-task-spec-acceptance"
              />
            ) : null}
            {done.length > 0 ? (
              <TaskSpecList
                label={t("card.taskSpec.definitionOfDone")}
                items={done}
                testId="card-task-spec-done"
              />
            ) : null}
          </>
        ) : (
          <p
            className="text-xs text-muted-foreground"
            data-testid="card-task-spec-empty"
          >
            {t("card.taskSpec.empty")}
          </p>
        )}
      </CollapsibleSection>
      <ConfirmDialog
        open={clearConfirm}
        onOpenChange={setClearConfirm}
        onClosed={handleClearClosed}
        title={t("card.taskSpec.clearTitle")}
        description={t("card.taskSpec.clearDescription")}
        confirmLabel={t("card.taskSpec.clear")}
        destructive
        onConfirm={() => {
          clearConfirmed.current = true;
          clear();
        }}
      />
    </>
  );
}

function TaskSpecList({
  label,
  items,
  testId,
}: {
  label: string;
  items: string[];
  testId: string;
}) {
  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <ul
        aria-label={label}
        className="list-disc space-y-0.5 pl-5 text-sm text-foreground"
        data-testid={testId}
      >
        {items.map((item, index) => (
          <li
            key={`${index}-${item}`}
            className="break-words [overflow-wrap:anywhere]"
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
