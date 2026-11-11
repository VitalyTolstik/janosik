import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  suggestWorkflowTemplate,
  validateWorkflowShape,
  WORKFLOW_CONDITIONS,
  WORKFLOW_SCHEMA_VERSION,
  type BoardRole,
  type BoardWorkflow,
  type Card,
  type Column,
  type WorkflowCondition,
  type WorkflowRole,
  type WorkflowTransition,
} from "@janosik/shared";

import { useI18n } from "@/i18n";
import { createId } from "@/utils/id";

export type WorkflowView = "columns" | "matrix";

const VIEW_STORAGE_KEY = "janosik.workflow.view";
const ROLES: WorkflowRole[] = ["ADMIN", "MEMBER"];

const EMPTY_WORKFLOW = (): BoardWorkflow => ({
  schemaVersion: WORKFLOW_SCHEMA_VERSION,
  enabled: false,
  doneColumnIds: [],
  transitions: [],
});

function canonical(workflow: BoardWorkflow | undefined): string {
  if (
    !workflow ||
    (!workflow.enabled &&
      workflow.transitions.length === 0 &&
      workflow.doneColumnIds.length === 0 &&
      workflow.initialColumnId === undefined)
  ) {
    return "null";
  }
  return JSON.stringify(workflow);
}

function readStoredView(): WorkflowView {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === "matrix"
      ? "matrix"
      : "columns";
  } catch {
    return "columns";
  }
}

function defaultActiveColumn(
  columns: Column[],
  workflow: BoardWorkflow | undefined,
): string {
  let best = columns[0];
  let bestCount = 0;
  for (const column of columns) {
    const count = (workflow?.transitions ?? []).filter(
      (transition) => transition.fromColumnId === column.id,
    ).length;
    if (count > bestCount) {
      best = column;
      bestCount = count;
    }
  }
  return best?.id ?? "";
}

function firstTransitionFrom(
  columns: Column[],
  workflow: BoardWorkflow | undefined,
  columnId: string,
): string | null {
  const sourceIndex = columns.findIndex((column) => column.id === columnId);
  const outgoing = (workflow?.transitions ?? []).filter(
    (transition) => transition.fromColumnId === columnId,
  );
  const forward = outgoing.find((transition) => {
    const targetIndex = columns.findIndex(
      (column) => column.id === transition.toColumnId,
    );
    return targetIndex > sourceIndex;
  });
  return (forward ?? outgoing[0])?.id ?? null;
}

export type WorkflowSave = (
  workflow: BoardWorkflow | undefined,
) => void | boolean | Promise<void | boolean>;

export interface UseWorkflowDraftOptions {
  columns: Column[];
  cards: Record<string, Card>;
  workflow?: BoardWorkflow;
  workflowInvalid?: boolean;
  canEdit: boolean;
  role?: BoardRole;
  saving?: boolean;
  onSave: WorkflowSave;
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * The workflow editor's state engine: one complete draft, its validation, the
 * selected transition/column, the preview card and save bookkeeping. It is
 * deliberately transport-free — the caller turns `onSave` into a board or
 * master-panel command — and it never mutates the stored `workflow` prop.
 */
export function useWorkflowDraft({
  columns,
  cards,
  workflow,
  workflowInvalid = false,
  canEdit,
  role = "ADMIN",
  saving = false,
  onSave,
  onDirtyChange,
}: UseWorkflowDraftOptions) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<BoardWorkflow>(
    () => workflow ?? EMPTY_WORKFLOW(),
  );
  const [view, setViewState] = useState<WorkflowView>(readStoredView);
  const [activeColumnId, setActiveColumnId] = useState(() =>
    defaultActiveColumn(columns, workflow),
  );
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const active = defaultActiveColumn(columns, workflow);
    return firstTransitionFrom(columns, workflow, active);
  });
  const [previewCardId, setPreviewCardId] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [foreignChange, setForeignChange] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const baseSignature = useRef(canonical(workflow));
  const pendingSavedSignature = useRef<string | null>(null);

  // A different admin may save while this editor is open. Never replace a
  // draft silently; show the banner and let the admin reload explicitly.
  useEffect(() => {
    if (saving) return;
    const incoming = canonical(workflow);
    if (
      pendingSavedSignature.current !== null &&
      incoming === pendingSavedSignature.current
    ) {
      baseSignature.current = incoming;
      pendingSavedSignature.current = null;
    }
    setForeignChange(incoming !== baseSignature.current);
  }, [workflow, saving]);

  const dirty = canonical(draft) !== canonical(workflow);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const mutateDraft = useCallback(
    (updater: (current: BoardWorkflow) => BoardWorkflow) => {
      setSaveFailed(false);
      // Tell a dialog guard immediately, before the post-render effect: a
      // keyboard Escape right after a click must still see the draft as dirty.
      onDirtyChange?.(true);
      setDraft(updater);
    },
    [onDirtyChange],
  );

  const columnById = useMemo(
    () => new Map(columns.map((column) => [column.id, column])),
    [columns],
  );
  const columnIds = useMemo(
    () => new Set(columns.map((column) => column.id)),
    [columns],
  );
  // Drop dangling ids from columns deleted while the editor is open. The
  // saved shape is what validation and the server see, so a stale edge cannot
  // mask "enabled with no active transition".
  const cleanDraft: BoardWorkflow = useMemo(
    () => ({
      ...draft,
      ...(draft.initialColumnId !== undefined &&
      !columnIds.has(draft.initialColumnId)
        ? { initialColumnId: undefined }
        : {}),
      doneColumnIds: draft.doneColumnIds.filter((id) => columnIds.has(id)),
      transitions: draft.transitions.filter(
        (transition) =>
          (transition.fromColumnId === null ||
            columnIds.has(transition.fromColumnId)) &&
          columnIds.has(transition.toColumnId),
      ),
    }),
    [draft, columnIds],
  );
  const selected =
    cleanDraft.transitions.find((transition) => transition.id === selectedId) ??
    undefined;
  const globals = useMemo(
    () =>
      cleanDraft.transitions.filter(
        (transition) => transition.fromColumnId === null,
      ),
    [cleanDraft],
  );
  const enabledCount = cleanDraft.transitions.filter(
    (transition) => transition.enabled !== false,
  ).length;
  const duplicateGlobal =
    globals.length !== new Set(globals.map((entry) => entry.toColumnId)).size;
  const shapeError = validateWorkflowShape(cleanDraft);
  const validationError =
    workflowInvalid && !dirty
      ? t("workflow.error.invalidStored")
      : cleanDraft.enabled && columns.length < 2
        ? t("workflow.error.oneColumn")
        : cleanDraft.enabled && enabledCount === 0
          ? t("workflow.error.noTransitions")
          : duplicateGlobal
            ? t("workflow.error.duplicateGlobal")
            : !shapeError.ok
              ? t("workflow.error.invalidShape", {
                  field: shapeError.field,
                  message: shapeError.message,
                })
              : null;
  const cardList = useMemo(
    () => Object.values(cards).filter((card) => card.archivedAt === undefined),
    [cards],
  );
  const previewCard =
    cardList.find((card) => card.id === previewCardId) ??
    columns
      .find((column) => column.id === activeColumnId)
      ?.cardIds.map((cardId) => cardList.find((card) => card.id === cardId))
      .find((card) => card !== undefined) ??
    cardList[0];
  const previewFrom = previewCard
    ? columns.find((column) => column.cardIds.includes(previewCard.id))
    : undefined;
  const outsideProcess = columns.filter(
    (column) =>
      !draft.transitions.some(
        (transition) =>
          transition.fromColumnId === column.id ||
          transition.toColumnId === column.id,
      ),
  );

  // A column may be deleted while the editor is open; keep the rail on a
  // column that still exists rather than rendering a blank panel.
  useEffect(() => {
    if (columns.length === 0) {
      if (activeColumnId !== "") setActiveColumnId("");
      return;
    }
    if (!columns.some((column) => column.id === activeColumnId)) {
      setActiveColumnId(defaultActiveColumn(columns, draft));
    }
  }, [columns, activeColumnId, draft]);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      // Storage is a convenience; a locked-down browser still gets the editor.
    }
  }, [view]);

  const transitionFor = useCallback(
    (from: string, to: string) =>
      draft.transitions.find(
        (transition) =>
          transition.fromColumnId === from && transition.toColumnId === to,
      ),
    [draft.transitions],
  );

  const updateTransition = useCallback(
    (id: string, patch: Partial<WorkflowTransition>) => {
      if (!canEdit) return;
      mutateDraft((current) => ({
        ...current,
        transitions: current.transitions.map((transition) =>
          transition.id === id ? { ...transition, ...patch } : transition,
        ),
      }));
    },
    [canEdit, mutateDraft],
  );

  const selectTransition = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      const transition = draft.transitions.find((entry) => entry.id === id);
      if (transition?.fromColumnId) setActiveColumnId(transition.fromColumnId);
    },
    [draft.transitions],
  );

  const selectColumn = useCallback(
    (id: string) => {
      setActiveColumnId(id);
      setSelectedId(firstTransitionFrom(columns, draft, id));
    },
    [draft],
  );

  const toggleCell = useCallback(
    (from: string, to: string) => {
      if (!canEdit || from === to) return;
      const existing = transitionFor(from, to);
      if (existing) {
        // The row hint promises one click for a disabled edge: bring it back
        // instead of forcing a trip through the inspector.
        if (existing.enabled === false) {
          updateTransition(existing.id, { enabled: true });
        }
        selectTransition(existing.id);
        return;
      }
      const transition: WorkflowTransition = {
        id: createId(),
        fromColumnId: from,
        toColumnId: to,
        allowedRoles: [...ROLES],
      };
      mutateDraft((current) => ({
        ...current,
        transitions: [...current.transitions, transition],
      }));
      setSelectedId(transition.id);
    },
    [canEdit, mutateDraft, selectTransition, transitionFor, updateTransition],
  );

  const allowDestination = useCallback(
    (to: string) => toggleCell(activeColumnId, to),
    [activeColumnId, toggleCell],
  );

  const setTransitionEnabled = useCallback(
    (id: string, enabled: boolean) => updateTransition(id, { enabled }),
    [updateTransition],
  );

  const deleteTransition = useCallback(
    (id: string) => {
      if (!canEdit) return;
      mutateDraft((current) => ({
        ...current,
        transitions: current.transitions.filter(
          (transition) => transition.id !== id,
        ),
      }));
      setSelectedId((current) => (current === id ? null : current));
    },
    [canEdit, mutateDraft],
  );

  const toggleRole = useCallback(
    (transition: WorkflowTransition, entry: WorkflowRole) => {
      if (!canEdit) return;
      const current = transition.allowedRoles ?? [...ROLES];
      const next = current.includes(entry)
        ? current.filter((role) => role !== entry)
        : [...current, entry];
      // An empty allow-list would deny everyone — almost certainly a mistake,
      // and the shared validator refuses it. Keep the last role checked.
      if (next.length === 0) return;
      updateTransition(transition.id, {
        allowedRoles: ROLES.filter((role) => next.includes(role)),
      });
    },
    [canEdit, updateTransition],
  );

  const toggleCondition = useCallback(
    (transition: WorkflowTransition, condition: WorkflowCondition) => {
      if (!canEdit) return;
      const current = transition.conditions ?? [];
      const next = current.includes(condition)
        ? current.filter((entry) => entry !== condition)
        : [...current, condition];
      updateTransition(transition.id, {
        conditions: WORKFLOW_CONDITIONS.filter((entry) => next.includes(entry)),
      });
    },
    [canEdit, updateTransition],
  );

  const reverseOf = useCallback(
    (transition: WorkflowTransition) =>
      transition.fromColumnId === null
        ? undefined
        : transitionFor(transition.toColumnId, transition.fromColumnId),
    [transitionFor],
  );

  const toggleReverse = useCallback(
    (transition: WorkflowTransition, checked: boolean) => {
      if (!canEdit || transition.fromColumnId === null) return;
      if (!checked) {
        const reverse = reverseOf(transition);
        if (reverse) deleteTransition(reverse.id);
        return;
      }
      if (reverseOf(transition)) return;
      const mirror: WorkflowTransition = {
        id: createId(),
        fromColumnId: transition.toColumnId,
        toColumnId: transition.fromColumnId,
        allowedRoles: [...(transition.allowedRoles ?? ROLES)],
        ...(transition.conditions && transition.conditions.length > 0
          ? { conditions: [...transition.conditions] }
          : {}),
      };
      mutateDraft((current) => ({
        ...current,
        transitions: [...current.transitions, mirror],
      }));
    },
    [canEdit, deleteTransition, mutateDraft, reverseOf],
  );

  const globalTargets = useMemo(
    () =>
      columns.filter(
        (column) =>
          !globals.some((transition) => transition.toColumnId === column.id),
      ),
    [columns, globals],
  );

  const addGlobal = useCallback(
    (toColumnId?: string) => {
      if (!canEdit) return;
      const target =
        toColumnId ??
        columns.find(
          (column) =>
            !globals.some((transition) => transition.toColumnId === column.id),
        )?.id;
      if (!target) return;
      if (globals.some((transition) => transition.toColumnId === target))
        return;
      const transition: WorkflowTransition = {
        id: createId(),
        fromColumnId: null,
        toColumnId: target,
        allowedRoles: [...ROLES],
      };
      mutateDraft((current) => ({
        ...current,
        transitions: [...current.transitions, transition],
      }));
      setSelectedId(transition.id);
    },
    [canEdit, columns, globals, mutateDraft],
  );

  const setInitialColumn = useCallback(
    (id: string | undefined) => {
      if (!canEdit) return;
      mutateDraft((current) => ({
        ...current,
        initialColumnId: id,
      }));
    },
    [canEdit, mutateDraft],
  );

  const setEnabled = useCallback(
    (enabled: boolean) => {
      if (!canEdit) return;
      mutateDraft((current) => ({ ...current, enabled }));
    },
    [canEdit, mutateDraft],
  );

  const toggleDoneColumn = useCallback(
    (id: string) => {
      if (!canEdit) return;
      mutateDraft((current) => ({
        ...current,
        doneColumnIds: current.doneColumnIds.includes(id)
          ? current.doneColumnIds.filter((entry) => entry !== id)
          : [...current.doneColumnIds, id],
      }));
    },
    [canEdit, mutateDraft],
  );

  const applyTemplate = useCallback(() => {
    if (!canEdit) return;
    const template = suggestWorkflowTemplate(columns);
    mutateDraft(() => template);
    const active = defaultActiveColumn(columns, template);
    setActiveColumnId(active);
    setSelectedId(firstTransitionFrom(columns, template, active));
  }, [canEdit, columns, mutateDraft]);

  const cleanWorkflow = useCallback((): BoardWorkflow => {
    if (cleanDraft.initialColumnId === undefined) {
      const { initialColumnId: _drop, ...rest } = cleanDraft;
      return rest;
    }
    return cleanDraft;
  }, [cleanDraft]);

  const runSave = useCallback(
    async (payload: BoardWorkflow | undefined) => {
      if (!canEdit) return false;
      setSaveFailed(false);
      try {
        const outcome = await onSave(payload);
        if (outcome === false) {
          setSaveFailed(true);
          return false;
        }
        pendingSavedSignature.current = canonical(payload);
        return true;
      } catch {
        setSaveFailed(true);
        return false;
      }
    },
    [canEdit, onSave],
  );

  const save = useCallback(async () => {
    if (validationError !== null) return false;
    return runSave(cleanWorkflow());
  }, [cleanWorkflow, runSave, validationError]);

  const resetWorkflow = useCallback(async () => {
    return runSave(undefined);
  }, [runSave]);

  const revert = useCallback(() => {
    setDraft(workflow ?? EMPTY_WORKFLOW());
    setSelectedId(null);
    setActiveColumnId(defaultActiveColumn(columns, workflow));
    setSaveFailed(false);
  }, [columns, workflow]);

  const reloadFromSaved = useCallback(() => {
    setDraft(workflow ?? EMPTY_WORKFLOW());
    baseSignature.current = canonical(workflow);
    pendingSavedSignature.current = null;
    setActiveColumnId(defaultActiveColumn(columns, workflow));
    setSelectedId(null);
    setForeignChange(false);
    setSaveFailed(false);
  }, [columns, workflow]);

  const setView = useCallback((next: WorkflowView) => setViewState(next), []);

  const transitionCountFor = useCallback(
    (columnId: string) =>
      cleanDraft.transitions.filter(
        (transition) =>
          transition.fromColumnId === columnId ||
          (transition.fromColumnId === null &&
            transition.toColumnId === columnId),
      ).length,
    [cleanDraft.transitions],
  );

  const enabledForColumn = cleanDraft.transitions.filter(
    (transition) =>
      transition.fromColumnId === activeColumnId &&
      transition.enabled !== false,
  ).length;

  return {
    draft,
    cleanDraft,
    view,
    setView,
    columns,
    cards,
    columnById,
    role,
    canEdit,
    saving,
    dirty,
    selected,
    selectedId,
    selectTransition,
    activeColumnId,
    selectColumn,
    globals,
    globalTargets,
    enabledCount,
    enabledForColumn,
    validationError,
    saveFailed,
    previewCard,
    previewCardId,
    setPreviewCardId,
    previewFrom,
    cardList,
    outsideProcess,
    confirmReset,
    setConfirmReset,
    foreignChange,
    transitionFor,
    transitionCountFor,
    updateTransition,
    toggleCell,
    allowDestination,
    setTransitionEnabled,
    deleteTransition,
    toggleRole,
    toggleCondition,
    reverseOf,
    toggleReverse,
    addGlobal,
    setInitialColumn,
    setEnabled,
    toggleDoneColumn,
    applyTemplate,
    save,
    resetWorkflow,
    revert,
    reloadFromSaved,
  };
}

export type WorkflowDraftController = ReturnType<typeof useWorkflowDraft>;
