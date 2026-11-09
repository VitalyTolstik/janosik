import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Lock,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Workflow,
} from "lucide-react";
import {
  suggestWorkflowTemplate,
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

import { ConfirmDialog } from "@/components/board/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { createId } from "@/utils/id";
import { conditionLabel, workflowBlockReason } from "@/utils/workflow";

interface WorkflowEditorProps {
  columns: Column[];
  cards: Record<string, Card>;
  workflow?: BoardWorkflow;
  /** ADMIN on the board, or a platform master acting for the owner. */
  canEdit: boolean;
  /** Master-panel mode: show the "acting for the owner" banner. */
  masterMode?: boolean;
  role?: BoardRole;
  saving?: boolean;
  onSave: (workflow: BoardWorkflow | undefined) => void | Promise<void>;
  onCancel?: () => void;
  /** Prefix for DOM test ids, so board and admin editors never collide. */
  testIdPrefix?: string;
}

const EMPTY_WORKFLOW = (): BoardWorkflow => ({
  schemaVersion: WORKFLOW_SCHEMA_VERSION,
  enabled: false,
  doneColumnIds: [],
  transitions: [],
});

const ROLES: WorkflowRole[] = ["ADMIN", "MEMBER"];

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

/**
 * The board-workflow editor: transition matrix, per-edge inspector, global
 * transitions, initial/done semantics and a live card preview. Reused by
 * «Board settings → Workflow» (board ADMIN) and by the master panel's
 * `/admin/boards/:id/workflow` page (OWNER/OPERATOR acting for the owner).
 *
 * The editor never talks to the transport: it owns a draft and calls
 * `onSave` with one complete `BoardWorkflow` (or `undefined` to reset), so
 * the caller decides whether that becomes a board command or an admin
 * command on behalf of the owner.
 */
export function WorkflowEditor({
  columns,
  cards,
  workflow,
  canEdit,
  masterMode = false,
  role = "ADMIN",
  saving = false,
  onSave,
  onCancel,
  testIdPrefix = "workflow",
}: WorkflowEditorProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<BoardWorkflow>(() => {
    return workflow ?? EMPTY_WORKFLOW();
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewCardId, setPreviewCardId] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [globalTarget, setGlobalTarget] = useState<string>("");

  const dirty = canonical(draft) !== canonical(workflow);
  const selected = draft.transitions.find(
    (transition) => transition.id === selectedId,
  );
  const globals = draft.transitions.filter(
    (transition) => transition.fromColumnId === null,
  );
  const columnById = useMemo(
    () => new Map(columns.map((column) => [column.id, column])),
    [columns],
  );
  const columnIds = new Set(columns.map((column) => column.id));
  const enabledCount = draft.transitions.filter(
    (transition) => transition.enabled !== false,
  ).length;
  const validationError =
    draft.enabled && columns.length < 2
      ? t("workflow.error.oneColumn")
      : draft.enabled && enabledCount === 0
        ? t("workflow.error.noTransitions")
        : null;
  const cardList = useMemo(
    () => Object.values(cards).filter((card) => card.archivedAt === undefined),
    [cards],
  );
  const previewCard =
    cardList.find((card) => card.id === previewCardId) ?? cardList[0];
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

  const transitionFor = (from: string, to: string) =>
    draft.transitions.find(
      (transition) =>
        transition.fromColumnId === from && transition.toColumnId === to,
    );

  const updateTransition = (id: string, patch: Partial<WorkflowTransition>) => {
    setDraft((current) => ({
      ...current,
      transitions: current.transitions.map((transition) =>
        transition.id === id ? { ...transition, ...patch } : transition,
      ),
    }));
  };

  const toggleCell = (from: string, to: string) => {
    if (!canEdit) return;
    const existing = transitionFor(from, to);
    if (existing) {
      setSelectedId(existing.id);
      return;
    }
    const transition: WorkflowTransition = {
      id: createId(),
      fromColumnId: from,
      toColumnId: to,
      allowedRoles: [...ROLES],
    };
    setDraft((current) => ({
      ...current,
      transitions: [...current.transitions, transition],
    }));
    setSelectedId(transition.id);
  };

  const deleteTransition = (id: string) => {
    setDraft((current) => ({
      ...current,
      transitions: current.transitions.filter(
        (transition) => transition.id !== id,
      ),
    }));
    setSelectedId((current) => (current === id ? null : current));
  };

  const toggleRole = (transition: WorkflowTransition, role: WorkflowRole) => {
    const current = transition.allowedRoles ?? [...ROLES];
    const next = current.includes(role)
      ? current.filter((entry) => entry !== role)
      : [...current, role];
    // An empty allow-list would deny everyone — almost certainly a mistake,
    // and the shared validator refuses it. Keep the last role checked.
    if (next.length === 0) return;
    updateTransition(transition.id, {
      allowedRoles: ROLES.filter((entry) => next.includes(entry)),
    });
  };

  const toggleCondition = (
    transition: WorkflowTransition,
    condition: WorkflowCondition,
  ) => {
    const current = transition.conditions ?? [];
    const next = current.includes(condition)
      ? current.filter((entry) => entry !== condition)
      : [...current, condition];
    updateTransition(transition.id, {
      conditions: WORKFLOW_CONDITIONS.filter((entry) => next.includes(entry)),
    });
  };

  const reverseOf = (transition: WorkflowTransition) =>
    transition.fromColumnId === null
      ? undefined
      : transitionFor(transition.toColumnId, transition.fromColumnId);

  const toggleReverse = (transition: WorkflowTransition, checked: boolean) => {
    if (transition.fromColumnId === null) return;
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
    setDraft((current) => ({
      ...current,
      transitions: [...current.transitions, mirror],
    }));
  };

  const addGlobal = () => {
    const toColumnId =
      globalTarget ||
      columns.find(
        (column) =>
          !globals.some((transition) => transition.toColumnId === column.id),
      )?.id;
    if (!toColumnId) return;
    if (globals.some((transition) => transition.toColumnId === toColumnId)) {
      return;
    }
    const transition: WorkflowTransition = {
      id: createId(),
      fromColumnId: null,
      toColumnId,
      allowedRoles: ["ADMIN"],
    };
    setDraft((current) => ({
      ...current,
      transitions: [...current.transitions, transition],
    }));
    setSelectedId(transition.id);
    setGlobalTarget("");
  };

  const save = () => {
    if (!canEdit || validationError !== null) return;
    // A column deleted while the editor was open leaves a dangling rule. It
    // is dropped on save; the same tolerant rule the importer uses.
    const clean: BoardWorkflow = {
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
    };
    if (clean.initialColumnId === undefined) {
      const { initialColumnId: _drop, ...rest } = clean;
      void onSave(rest);
      return;
    }
    void onSave(clean);
  };

  const titleOf = (id: string | null): string =>
    id === null ? t("workflow.anyColumn") : (columnById.get(id)?.title ?? id);

  return (
    <div
      className="flex min-h-0 flex-col gap-3"
      data-testid={`${testIdPrefix}-editor`}
    >
      {masterMode ? (
        <div className="rounded-lg border border-primary/30 bg-primary/10 p-2.5 text-xs">
          {t("workflow.masterBanner")}
        </div>
      ) : null}
      {!canEdit ? (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-xs">
          {t("workflow.adminOnly")}
        </div>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <Workflow className="h-4 w-4 text-primary" aria-hidden />
            {t("workflow.title")}
          </p>
          <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">
            {t("workflow.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs">
            <Checkbox
              checked={draft.enabled}
              disabled={!canEdit}
              onCheckedChange={(checked) =>
                setDraft((current) => ({ ...current, enabled: checked }))
              }
              data-testid={`${testIdPrefix}-enabled`}
              aria-label={t("workflow.enable")}
            />
            {t("workflow.enable")}
          </label>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium",
              draft.enabled
                ? "bg-success/15 text-success"
                : "bg-muted text-muted-foreground",
            )}
          >
            {draft.enabled ? t("workflow.enabled") : t("workflow.disabled")}
          </span>
        </div>
      </div>
      <p className="-mt-1 text-[11px] text-muted-foreground">
        {t("workflow.enableHint")}
      </p>

      {validationError ? (
        <p
          className="flex items-center gap-1.5 rounded-md border border-danger/30 bg-danger/10 px-2 py-1.5 text-xs text-danger"
          data-testid={`${testIdPrefix}-error`}
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {validationError}
        </p>
      ) : null}

      <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-3">
          <section className="rounded-lg border border-border/60">
            <header className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
              <p className="text-xs font-semibold">{t("workflow.matrix")}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[11px]"
                disabled={!canEdit || columns.length < 2}
                onClick={() => {
                  setDraft(suggestWorkflowTemplate(columns));
                  setSelectedId(null);
                }}
                data-testid={`${testIdPrefix}-template`}
              >
                <Sparkles className="h-3 w-3" aria-hidden />
                {t("workflow.useTemplate")}
              </Button>
            </header>
            <div className="max-w-full overflow-x-auto p-2">
              <table
                className="w-full min-w-[28rem] border-separate border-spacing-0 text-[11px]"
                role="grid"
                aria-label={t("workflow.matrix")}
              >
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-popover px-2 py-1.5 text-left font-medium text-muted-foreground">
                      {t("workflow.fromTo")}
                    </th>
                    {columns.map((column) => (
                      <th
                        key={column.id}
                        scope="col"
                        className="max-w-24 truncate px-1 py-1.5 text-center font-medium text-muted-foreground"
                        title={column.title}
                      >
                        {column.title}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {columns.map((from) => (
                    <tr key={from.id}>
                      <th
                        scope="row"
                        className="sticky left-0 z-10 max-w-32 truncate bg-popover px-2 py-1 text-left font-medium"
                        title={from.title}
                      >
                        {from.title}
                      </th>
                      {columns.map((to) => {
                        const transition = transitionFor(from.id, to.id);
                        const on =
                          transition !== undefined &&
                          transition.enabled !== false;
                        const isSelected =
                          transition !== undefined &&
                          selectedId === transition.id;
                        return (
                          <td key={to.id} className="p-0.5 text-center">
                            <button
                              type="button"
                              disabled={!canEdit || from.id === to.id}
                              aria-pressed={on}
                              aria-label={t("workflow.cellLabel", {
                                from: from.title,
                                to: to.title,
                              })}
                              title={
                                from.id === to.id
                                  ? t("workflow.diagonalHint")
                                  : on
                                    ? t("workflow.cellOnHint")
                                    : t("workflow.cellOffHint")
                              }
                              data-testid={`${testIdPrefix}-cell-${from.id}-${to.id}`}
                              onClick={() => toggleCell(from.id, to.id)}
                              className={cn(
                                "flex h-7 w-full min-w-6 items-center justify-center rounded border transition-colors",
                                from.id === to.id
                                  ? "cursor-default border-transparent text-muted-foreground/40"
                                  : on
                                    ? "border-primary/60 bg-primary/15 text-primary"
                                    : "border-border/60 text-muted-foreground hover:border-primary/40 hover:bg-primary/5",
                                isSelected && "ring-2 ring-ring",
                              )}
                            >
                              {from.id === to.id ? (
                                "—"
                              ) : on ? (
                                <Check className="h-3.5 w-3.5" />
                              ) : (
                                "·"
                              )}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-border/60 px-3 py-1.5 text-[10px] text-muted-foreground">
              {t("workflow.matrixHint")}
            </p>
          </section>

          <section className="rounded-lg border border-border/60">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
              <p className="text-xs font-semibold">{t("workflow.global")}</p>
              <div className="flex items-center gap-1.5">
                <select
                  value={globalTarget}
                  disabled={!canEdit}
                  aria-label={t("workflow.globalTarget")}
                  data-testid={`${testIdPrefix}-global-target`}
                  onChange={(event) => setGlobalTarget(event.target.value)}
                  className="h-7 max-w-40 rounded-md border border-input bg-transparent px-1.5 text-[11px]"
                >
                  <option value="">{t("workflow.globalTarget")}</option>
                  {columns.map((column) => (
                    <option key={column.id} value={column.id}>
                      {column.title}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px]"
                  disabled={!canEdit || columns.length === 0}
                  onClick={addGlobal}
                  data-testid={`${testIdPrefix}-global-add`}
                >
                  <Plus className="h-3 w-3" aria-hidden />
                  {t("workflow.globalAdd")}
                </Button>
              </div>
            </header>
            <div className="flex flex-wrap gap-1.5 p-2">
              {globals.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  {t("workflow.globalEmpty")}
                </p>
              ) : (
                globals.map((transition) => (
                  <button
                    key={transition.id}
                    type="button"
                    onClick={() => setSelectedId(transition.id)}
                    data-testid={`${testIdPrefix}-global-${transition.id}`}
                    className={cn(
                      "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                      selectedId === transition.id
                        ? "border-primary/60 bg-primary/10"
                        : "border-warning/40 bg-warning/10",
                    )}
                  >
                    <Sparkles className="h-3 w-3 text-warning" aria-hidden />
                    {t(
                      "workflow.anyColumn",
                    )} <ArrowRight className="h-3 w-3" />{" "}
                    {titleOf(transition.toColumnId)}
                    <span className="text-muted-foreground">
                      · {(transition.allowedRoles ?? ROLES).join("/")}
                    </span>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="rounded-lg border border-border/60 p-3">
            <p className="text-xs font-semibold">
              {t("workflow.columnSemantics")}
            </p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <label className="text-[11px]">
                <span className="block text-muted-foreground">
                  {t("workflow.initialColumn")}
                </span>
                <select
                  value={draft.initialColumnId ?? ""}
                  disabled={!canEdit}
                  data-testid={`${testIdPrefix}-initial`}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      initialColumnId: event.target.value || undefined,
                    }))
                  }
                  className="mt-1 h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs"
                >
                  <option value="">{t("workflow.initialFallback")}</option>
                  {columns.map((column) => (
                    <option key={column.id} value={column.id}>
                      {column.title}
                    </option>
                  ))}
                </select>
              </label>
              <div className="text-[11px]">
                <span className="block text-muted-foreground">
                  {t("workflow.doneColumns")}
                </span>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  {columns.map((column) => (
                    <label
                      key={column.id}
                      className="flex items-center gap-1.5"
                    >
                      <Checkbox
                        checked={draft.doneColumnIds.includes(column.id)}
                        disabled={!canEdit}
                        aria-label={column.title}
                        data-testid={`${testIdPrefix}-done-${column.id}`}
                        onCheckedChange={(checked) =>
                          setDraft((current) => ({
                            ...current,
                            doneColumnIds: checked
                              ? [...current.doneColumnIds, column.id]
                              : current.doneColumnIds.filter(
                                  (id) => id !== column.id,
                                ),
                          }))
                        }
                      />
                      {column.title}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
              {t("workflow.columnSemanticsHint")}
            </p>
            {outsideProcess.length > 0 ? (
              <p className="mt-2 text-[10px] text-warning">
                {t("workflow.outsideProcess", {
                  columns: outsideProcess
                    .map((column) => column.title)
                    .join(", "),
                })}
              </p>
            ) : null}
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-3">
          <section className="rounded-lg border border-border/60">
            <header className="border-b border-border/60 px-3 py-2">
              <p className="text-xs font-semibold">{t("workflow.inspector")}</p>
            </header>
            <div className="space-y-3 p-3">
              {!selected ? (
                <p className="text-[11px] text-muted-foreground">
                  {t("workflow.inspectorEmpty")}
                </p>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {selected.fromColumnId === null
                          ? t("workflow.global")
                          : t("workflow.transition")}
                      </p>
                      <p
                        className="truncate text-xs font-semibold"
                        data-testid={`${testIdPrefix}-inspector-title`}
                      >
                        {titleOf(selected.fromColumnId)} →{" "}
                        {titleOf(selected.toColumnId)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 shrink-0 text-danger"
                      aria-label={t("workflow.deleteTransition")}
                      data-testid={`${testIdPrefix}-delete`}
                      onClick={() => deleteTransition(selected.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {selected.fromColumnId === null ? (
                    <label className="block text-[11px]">
                      <span className="block text-muted-foreground">
                        {t("workflow.globalTarget")}
                      </span>
                      <select
                        value={selected.toColumnId}
                        disabled={!canEdit}
                        data-testid={`${testIdPrefix}-global-edit-target`}
                        onChange={(event) =>
                          updateTransition(selected.id, {
                            toColumnId: event.target.value,
                          })
                        }
                        className="mt-1 h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs"
                      >
                        {columns.map((column) => (
                          <option key={column.id} value={column.id}>
                            {column.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}

                  <div>
                    <p className="text-[11px] text-muted-foreground">
                      {t("workflow.roles")}
                    </p>
                    <div className="mt-1 flex flex-col gap-1">
                      {ROLES.map((entry) => (
                        <label
                          key={entry}
                          className="flex items-center gap-2 text-[11px]"
                        >
                          <Checkbox
                            checked={(selected.allowedRoles ?? ROLES).includes(
                              entry,
                            )}
                            disabled={!canEdit}
                            aria-label={entry}
                            data-testid={`${testIdPrefix}-role-${entry}`}
                            onCheckedChange={() => toggleRole(selected, entry)}
                          />
                          {entry}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-[11px] text-muted-foreground">
                      {t("workflow.conditions")}
                    </p>
                    <div className="mt-1 flex flex-col gap-1">
                      {WORKFLOW_CONDITIONS.map((condition) => (
                        <label
                          key={condition}
                          className="flex items-center gap-2 text-[11px]"
                        >
                          <Checkbox
                            checked={(selected.conditions ?? []).includes(
                              condition,
                            )}
                            disabled={!canEdit}
                            aria-label={conditionLabel(condition, t)}
                            data-testid={`${testIdPrefix}-condition-${condition}`}
                            onCheckedChange={() =>
                              toggleCondition(selected, condition)
                            }
                          />
                          {conditionLabel(condition, t)}
                        </label>
                      ))}
                    </div>
                  </div>

                  {selected.fromColumnId !== null ? (
                    <label className="flex items-start gap-2 text-[11px]">
                      <Checkbox
                        checked={reverseOf(selected) !== undefined}
                        disabled={!canEdit}
                        aria-label={t("workflow.reverse")}
                        data-testid={`${testIdPrefix}-reverse`}
                        onCheckedChange={(checked) =>
                          toggleReverse(selected, checked)
                        }
                      />
                      <span>
                        {t("workflow.reverse")}
                        <span className="block text-[10px] text-muted-foreground">
                          {t("workflow.reverseHint")}
                        </span>
                      </span>
                    </label>
                  ) : null}

                  <label className="flex items-center gap-2 text-[11px]">
                    <Checkbox
                      checked={selected.enabled !== false}
                      disabled={!canEdit}
                      aria-label={t("workflow.transitionEnabled")}
                      data-testid={`${testIdPrefix}-transition-enabled`}
                      onCheckedChange={(checked) =>
                        updateTransition(selected.id, { enabled: checked })
                      }
                    />
                    {t("workflow.transitionEnabled")}
                  </label>

                  <p className="rounded-md bg-muted/50 p-2 text-[10px] leading-snug text-muted-foreground">
                    {t("workflow.wipHint")}
                  </p>
                </>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-border/60">
            <header className="border-b border-border/60 px-3 py-2">
              <p className="text-xs font-semibold">{t("workflow.preview")}</p>
            </header>
            <div className="space-y-2 p-3">
              {previewCard ? (
                <>
                  <select
                    value={previewCard.id}
                    onChange={(event) => setPreviewCardId(event.target.value)}
                    aria-label={t("workflow.previewCard")}
                    data-testid={`${testIdPrefix}-preview-card`}
                    className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-[11px]"
                  >
                    {cardList.map((card) => (
                      <option key={card.id} value={card.id}>
                        {card.title}
                      </option>
                    ))}
                  </select>
                  {previewFrom ? (
                    <ul className="space-y-1">
                      {columns
                        .filter((column) => column.id !== previewFrom.id)
                        .map((column) => {
                          const reason = workflowBlockReason(
                            {
                              workflow: draft,
                              card: previewCard,
                              fromColumnId: previewFrom.id,
                              fromTitle: previewFrom.title,
                              target: column,
                              role,
                            },
                            t,
                          );
                          return (
                            <li
                              key={column.id}
                              data-testid={`${testIdPrefix}-preview-${column.id}`}
                              className="flex items-start gap-1.5 text-[11px]"
                            >
                              {reason === null ? (
                                <Check className="mt-px h-3.5 w-3.5 shrink-0 text-success" />
                              ) : (
                                <Lock className="mt-px h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              )}
                              <span>
                                <strong>{column.title}</strong> —{" "}
                                <span className="text-muted-foreground">
                                  {reason ?? t("workflow.allowed")}
                                </span>
                              </span>
                            </li>
                          );
                        })}
                    </ul>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      {t("workflow.previewNoCard")}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  {t("workflow.previewNoCards")}
                </p>
              )}
            </div>
          </section>
        </aside>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
        <span
          className="text-[11px] text-muted-foreground"
          data-testid={`${testIdPrefix}-dirty`}
        >
          {dirty ? t("workflow.unsaved") : t("workflow.saved")}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {onCancel ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onCancel}
              disabled={saving}
            >
              {t("workflow.cancel")}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="text-danger"
            disabled={!canEdit || saving || workflow === undefined}
            onClick={() => setConfirmReset(true)}
            data-testid={`${testIdPrefix}-reset`}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            {t("workflow.reset")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!canEdit || saving || !dirty || validationError !== null}
            onClick={save}
            data-testid={`${testIdPrefix}-save`}
          >
            {saving ? t("workflow.saving") : t("workflow.save")}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={t("workflow.resetTitle")}
        description={t("workflow.resetDescription")}
        confirmLabel={t("workflow.reset")}
        destructive
        onConfirm={() => {
          setConfirmReset(false);
          void onSave(undefined);
        }}
      />
    </div>
  );
}
