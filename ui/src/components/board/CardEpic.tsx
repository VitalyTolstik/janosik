import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { epicOf, LIMITS, type Board, type Card } from "@janosik/shared";

import {
  EpicDot,
  EpicOption,
  EpicTitleForm,
} from "@/components/board/EpicAssignmentParts";
import { SelectField, type SelectOption } from "@/components/ui/select-field";
import { useI18n } from "@/i18n";
import { useBoardActions } from "@/store/BoardContext";
import { unhydratedEpicProgress } from "@/store/read-model";
import { collectBacklogEpics } from "@/utils/backlog-rows";
import { addAssignmentEpic } from "@/utils/epic-assignment";

export function CardEpic({
  board,
  card,
  readOnly,
  onNewOpenChange,
}: {
  board: Board;
  card: Card;
  readOnly: boolean;
  onNewOpenChange: (close: (() => void) | null) => void;
}) {
  const { t } = useI18n();
  const { dispatch, dispatchEpicCreation } = useBoardActions();
  const labelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const pendingCreation = useRef(false);
  const restoreTriggerFocus = useRef(false);
  const [creating, setCreating] = useState(false);
  const current = epicOf(board, card.epicId);

  useEffect(() => () => onNewOpenChange(null), [onNewOpenChange]);

  useLayoutEffect(() => {
    if (creating || !restoreTriggerFocus.current) return;
    restoreTriggerFocus.current = false;
    trigger.current?.focus();
  }, [creating]);

  function close() {
    if (pendingCreation.current) {
      pendingCreation.current = false;
      trigger.current?.focus();
    } else {
      restoreTriggerFocus.current = true;
    }
    setCreating(false);
    onNewOpenChange(null);
  }

  function pick(id: string | null) {
    if (id === (card.epicId ?? null)) return;
    return dispatch({
      type: "SET_CARD_EPIC",
      boardId: board.id,
      cardId: card.id,
      epicId: id,
      at: Date.now(),
    });
  }

  const options: SelectOption<string>[] = [];
  let newOption = "";
  const noEpic = "";
  if (!readOnly) {
    const epics = collectBacklogEpics(board, unhydratedEpicProgress(board));
    for (const entry of epics.values()) {
      if (entry.epic.status === "active") {
        options.push({
          value: entry.epic.id,
          label: entry.epic.title,
          content: <EpicOption entry={entry} />,
        });
      }
    }
    // IDs are opaque strings, so keep synthetic options outside the catalog.
    newOption = "+";
    while (epics.has(newOption)) newOption += "+";
    options.push({ value: noEpic, label: t("epic.none") });
    if (epics.size < LIMITS.epicsPerBoard)
      options.push({ value: newOption, label: t("epic.new") });
  }

  const value = current?.id ?? noEpic;
  const currentLabel = current?.title ?? t("epic.none");
  return (
    <div className="min-w-0 space-y-1.5">
      <span
        id={labelId}
        className="block text-ui-label font-medium text-muted-foreground"
      >
        {t("epic.field")}
      </span>
      {readOnly ? (
        <p
          data-testid="card-epic-readonly"
          className="wrap-break-word text-ui-body"
        >
          {currentLabel}
        </p>
      ) : (
        <>
          <SelectField
            value={value}
            options={options}
            labelledBy={labelId}
            displayLabel={currentLabel}
            leadingIcon={current?.status === "active" ? <EpicDot /> : undefined}
            testId="card-epic"
            triggerRef={trigger}
            onCloseAutoFocus={(event) => {
              if (!pendingCreation.current) return;
              event.preventDefault();
              pendingCreation.current = false;
              setCreating(true);
            }}
            onChange={(id) => {
              if (id === newOption) {
                // The listbox must finish closing before the form takes focus.
                pendingCreation.current = true;
                onNewOpenChange(close);
              } else {
                void pick(id || null);
              }
            }}
          />
          {creating ? (
            <EpicTitleForm
              onCancel={close}
              onSubmit={(title) => {
                close();
                addAssignmentEpic(board.id, title, dispatchEpicCreation, [
                  card.id,
                ]);
              }}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
