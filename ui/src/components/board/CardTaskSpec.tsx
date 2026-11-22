import { useEffect, useRef, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import { CollapsibleSection } from "@/components/board/CollapsibleSection";
import { ConfirmDialog } from "@/components/board/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n";
import { useBoardActions } from "@/store/BoardContext";
import { LIMITS } from "@janosik/shared";

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
}: {
  cardId: string;
  acceptanceCriteria?: string[];
  definitionOfDone?: string[];
  /** ADMIN/MEMBER and a writable card (TASK-177.4 decision 1). */
  canEdit?: boolean;
}) {
  const { t } = useI18n();
  const { setCardTaskSpec } = useBoardActions();
  const criteria = acceptanceCriteria ?? [];
  const done = definitionOfDone ?? [];
  const hasSpec = criteria.length > 0 || done.length > 0;

  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [criteriaDraft, setCriteriaDraft] = useState("");
  const [doneDraft, setDoneDraft] = useState("");
  const [error, setError] = useState<"tooMany" | "tooLong" | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const firstFieldRef = useRef<HTMLTextAreaElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (editing) firstFieldRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!editing && returnFocus.current) {
      returnFocus.current = false;
      editButtonRef.current?.focus();
    }
  }, [editing]);

  // The dialog can swap cards without unmounting, so CardDialog keys this
  // component by card id; local drafts therefore never cross cards.
  if (!hasSpec && !canEdit) return null;

  const startEditing = () => {
    setCriteriaDraft(criteria.join("\n"));
    setDoneDraft(done.join("\n"));
    setError(null);
    setExpanded(true);
    setEditing(true);
  };

  const closeEditor = () => {
    returnFocus.current = true;
    setEditing(false);
    setError(null);
  };

  const parse = (value: string): string[] =>
    value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter((item) => item !== "");

  const save = () => {
    const nextCriteria = parse(criteriaDraft);
    const nextDone = parse(doneDraft);
    if (
      nextCriteria.length > LIMITS.taskSpecItems ||
      nextDone.length > LIMITS.taskSpecItems
    ) {
      setError("tooMany");
      return;
    }
    const all = [...nextCriteria, ...nextDone];
    if (all.some((item) => item.length > LIMITS.taskSpecItem)) {
      setError("tooLong");
      return;
    }
    setCardTaskSpec(cardId, {
      acceptanceCriteria: nextCriteria,
      definitionOfDone: nextDone,
    });
    closeEditor();
  };

  const clear = () => {
    setCardTaskSpec(cardId, {
      acceptanceCriteria: [],
      definitionOfDone: [],
    });
    setEditing(false);
    setError(null);
  };

  const action =
    canEdit && !editing ? (
      <div className="flex items-center gap-1">
        {hasSpec ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1 px-2 text-xs max-md:min-h-11 no-hover:min-h-11"
            data-testid="card-task-spec-clear"
            onClick={() => setClearConfirm(true)}
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
          className="h-8 gap-1 px-2 text-xs max-md:min-h-11 no-hover:min-h-11"
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
          setExpanded(next);
          if (!next && editing) closeEditor();
        }}
        action={action}
        contentClassName="mt-1.5 space-y-2"
      >
        {editing ? (
          <form
            className="space-y-2"
            data-testid="card-task-spec-form"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                closeEditor();
              }
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
                ref={firstFieldRef}
                value={criteriaDraft}
                onChange={(event) => {
                  setCriteriaDraft(event.target.value);
                  setError(null);
                }}
                rows={3}
                data-testid="card-task-spec-criteria-input"
              />
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
                value={doneDraft}
                onChange={(event) => {
                  setDoneDraft(event.target.value);
                  setError(null);
                }}
                rows={3}
                data-testid="card-task-spec-done-input"
              />
            </div>
            <p className="text-[11px] leading-snug text-muted-foreground">
              {t("card.taskSpec.hint", {
                count: LIMITS.taskSpecItems,
                length: LIMITS.taskSpecItem,
              })}
            </p>
            {error !== null ? (
              <p
                role="alert"
                data-testid="card-task-spec-error"
                className="text-xs text-destructive"
              >
                {error === "tooMany"
                  ? t("card.taskSpec.tooMany", {
                      count: LIMITS.taskSpecItems,
                    })
                  : t("card.taskSpec.tooLong", {
                      length: LIMITS.taskSpecItem,
                    })}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="max-md:min-h-11 no-hover:min-h-11"
                data-testid="card-task-spec-cancel"
                onClick={closeEditor}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                size="sm"
                className="max-md:min-h-11 no-hover:min-h-11"
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
        title={t("card.taskSpec.clearTitle")}
        description={t("card.taskSpec.clearDescription")}
        confirmLabel={t("card.taskSpec.clear")}
        destructive
        onConfirm={clear}
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
        className="list-disc space-y-0.5 pl-5 text-sm text-foreground"
        data-testid={testId}
      >
        {items.map((item, index) => (
          <li key={`${index}-${item}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
