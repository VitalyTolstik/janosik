import {
  AlertTriangle,
  MoreHorizontal,
  RotateCcw,
  Rows3,
  Sparkles,
  Table2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { BoardRole, BoardWorkflow, Card, Column } from "@janosik/shared";

import { ConfirmDialog } from "@/components/board/ConfirmDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DialogClose,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { ColumnRail } from "./ColumnRail";
import { ColumnSemantics } from "./ColumnSemantics";
import { GlobalTransitions } from "./GlobalTransitions";
import { TransitionInspector } from "./TransitionInspector";
import { TransitionList } from "./TransitionList";
import { TransitionMatrix } from "./TransitionMatrix";
import {
  useWorkflowDraft,
  type WorkflowSave,
  type WorkflowView,
} from "./useWorkflowDraft";

export interface WorkflowSettingsProps {
  columns: Column[];
  cards: Record<string, Card>;
  workflow?: BoardWorkflow;
  workflowInvalid?: boolean;
  canEdit: boolean;
  masterMode?: boolean;
  role?: BoardRole;
  saving?: boolean;
  onSave: WorkflowSave;
  onCancel?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  testIdPrefix?: string;
  /** Dialog shell (default) or the master panel's embedded page. */
  variant?: "dialog" | "embedded";
  insideSettingsShell?: boolean;
}

/**
 * «Настройки доски → Правила переходов», direction 01 «Рельс доски».
 *
 * One surface: a dialog header, the board's columns as a tab rail, a list of
 * rules from the selected column, a compact global/semantics footer and a
 * context inspector. The full matrix stays available as a secondary tab. The
 * master panel reuses the same body as `variant="embedded"`.
 */
export function WorkflowSettings({
  columns,
  cards,
  workflow,
  workflowInvalid = false,
  canEdit,
  masterMode = false,
  role = "ADMIN",
  saving = false,
  onSave,
  onCancel,
  onDirtyChange,
  testIdPrefix = "workflow",
  variant = "embedded",
  insideSettingsShell = false,
}: WorkflowSettingsProps) {
  const { t } = useI18n();
  const controller = useWorkflowDraft({
    columns,
    cards,
    workflow,
    workflowInvalid,
    canEdit,
    role,
    saving,
    onSave,
    onDirtyChange,
  });
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const saveErrorRef = useRef<HTMLDivElement>(null);
  const viewRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const {
    draft,
    dirty,
    view,
    setView,
    activeColumnId,
    selectColumn,
    selectTransition,
    globals,
    globalTargets,
    enabledForColumn,
    validationError,
    saveFailed,
    confirmReset,
    setConfirmReset,
    foreignChange,
    transitionCountFor,
    setTransitionEnabled,
    allowDestination,
    addGlobal,
    applyTemplate,
    save,
    resetWorkflow,
    revert,
    reloadFromSaved,
    setEnabled,
  } = controller;

  useEffect(() => {
    if (!saveFailed) return;
    saveErrorRef.current?.focus();
  }, [saveFailed]);

  const statusText = saving
    ? t("workflow.saving")
    : saveFailed
      ? t("workflow.saveError")
      : dirty
        ? t("workflow.unsaved")
        : t("workflow.saved");
  const statusHint = saveFailed
    ? t("workflow.saveErrorHint")
    : t("workflow.footerHint");
  const statusTone = saving
    ? "bg-primary"
    : saveFailed
      ? "bg-danger"
      : dirty
        ? "bg-warning"
        : "bg-success";
  const counts = Object.fromEntries(
    columns.map((column) => [column.id, transitionCountFor(column.id)]),
  );
  const activeRailId = activeColumnId
    ? `${testIdPrefix}-rail-tab-${activeColumnId}`
    : undefined;

  const views: { id: WorkflowView; label: string; icon: typeof Rows3 }[] = [
    { id: "columns", label: t("workflow.view.columns"), icon: Rows3 },
    { id: "matrix", label: t("workflow.view.matrix"), icon: Table2 },
  ];

  const onViewKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const index = views.findIndex((entry) => entry.id === view);
    const step = event.key === "ArrowRight" ? 1 : -1;
    const next = views[(index + step + views.length) % views.length];
    if (!next) return;
    setView(next.id);
    viewRefs.current[next.id]?.focus();
  };

  const openRule = (id: string) => {
    selectTransition(id);
    setInspectorOpen(true);
    // On a phone the inspector is an accordion below the list. Bring it into
    // view after the selected rule has rendered; honour reduced motion.
    if (typeof window.matchMedia !== "function") return;
    if (window.matchMedia("(max-width: 767px)").matches) {
      if (typeof requestAnimationFrame !== "function") return;
      requestAnimationFrame(() => {
        document
          .getElementById(`${testIdPrefix}-inspector-section`)
          ?.scrollIntoView({
            block: "nearest",
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
              .matches
              ? "auto"
              : "smooth",
          });
      });
    }
  };
  const openColumn = (id: string) => {
    selectColumn(id);
    setInspectorOpen(true);
  };

  const requestCancel = () => {
    if (!onCancel) return;
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onCancel();
  };

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col bg-popover text-foreground",
        variant === "dialog" && "min-h-0 flex-1 overflow-hidden",
      )}
      data-testid={`${testIdPrefix}-editor`}
      aria-busy={saving || undefined}
    >
      <header className="flex shrink-0 items-start gap-[18px] border-b border-border/75 px-5 pb-[15px] pt-[17px] max-md:flex-wrap max-md:gap-2 max-md:px-3.5 max-md:pb-3 max-md:pt-[13px]">
        {!insideSettingsShell ? (
          <div className="min-w-0">
            {variant === "dialog" ? (
              <DialogTitle className="m-0 text-lg font-semibold leading-[1.2] tracking-[-0.025em] text-foreground max-md:text-base">
                {t("board.settings.title")}
              </DialogTitle>
            ) : (
              <h2 className="m-0 text-lg font-semibold leading-[1.2] tracking-[-0.025em] text-foreground max-md:text-base">
                {t("workflow.title")}
              </h2>
            )}
            {variant === "dialog" ? (
              <DialogDescription className="mt-1 max-w-[66ch] text-[12.5px] leading-[1.48] text-muted-foreground max-md:text-[11px]">
                {t("board.settings.subtitle")}
              </DialogDescription>
            ) : (
              <p className="mt-1 max-w-[66ch] text-[12.5px] leading-[1.48] text-muted-foreground max-md:text-[11px]">
                {t("workflow.subtitle")}
              </p>
            )}
          </div>
        ) : null}

        <div className="ml-auto flex flex-none items-center gap-[9px] max-md:ml-0 max-md:w-full max-md:justify-end">
          <div
            role="tablist"
            aria-label={t("workflow.view.label")}
            className="flex items-center gap-0.5 rounded-md border border-border bg-card/55 p-0.5"
          >
            {views.map((entry) => {
              const Icon = entry.icon;
              const active = view === entry.id;
              return (
                <button
                  key={entry.id}
                  ref={(element) => {
                    viewRefs.current[entry.id] = element;
                  }}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-label={entry.label}
                  aria-controls={`${testIdPrefix}-panel`}
                  tabIndex={active ? 0 : -1}
                  data-testid={`${testIdPrefix}-tab-${entry.id}`}
                  onClick={() => setView(entry.id)}
                  onKeyDown={onViewKeyDown}
                  className={cn(
                    "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded px-1.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover motion-reduce:transition-none",
                    active
                      ? "bg-hover text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--muted-foreground)_22%,transparent)]"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-3 w-3" aria-hidden />
                  <span className="max-[360px]:hidden">{entry.label}</span>
                </button>
              );
            })}
          </div>

          <div
            className={cn(
              "flex h-7 items-center gap-2 rounded-full border border-border bg-card/65 py-1 pl-2.5 pr-2 max-md:border-transparent max-md:bg-transparent max-md:p-0.5",
            )}
          >
            <span className="whitespace-nowrap text-[11px] leading-4 text-muted-foreground max-md:hidden">
              {draft.enabled ? t("workflow.enabled") : t("workflow.disabled")}
            </span>
            <Switch
              checked={draft.enabled}
              disabled={!canEdit}
              aria-label={t("workflow.enable")}
              data-testid={`${testIdPrefix}-enabled`}
              onCheckedChange={setEnabled}
            />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t("workflow.moreActions")}
                data-testid={`${testIdPrefix}-more`}
                className="grid h-[29px] w-[29px] shrink-0 place-items-center rounded-md border border-transparent text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
              >
                <MoreHorizontal className="h-4 w-4" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              <DropdownMenuItem
                disabled={!canEdit || saving || columns.length < 2}
                data-testid={`${testIdPrefix}-template`}
                onSelect={applyTemplate}
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                {t("workflow.template")}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canEdit || saving || workflow === undefined}
                data-testid={`${testIdPrefix}-reset`}
                onSelect={() => setConfirmReset(true)}
                className="text-danger focus:text-danger"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                {t("workflow.resetRules")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {variant === "dialog" && !insideSettingsShell ? (
            <DialogClose asChild>
              <button
                type="button"
                aria-label={t("common.close")}
                data-testid={`${testIdPrefix}-close`}
                className="grid h-[29px] w-[29px] shrink-0 place-items-center rounded-md border border-transparent text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </DialogClose>
          ) : null}
        </div>
      </header>

      <div
        className={cn(
          "min-w-0",
          variant === "dialog" &&
            "min-h-0 flex-1 overflow-y-auto overscroll-contain",
        )}
        data-testid={`${testIdPrefix}-body`}
      >
        <ColumnRail
          columns={columns}
          cards={cards}
          activeId={activeColumnId}
          counts={counts}
          onSelect={openColumn}
          testIdPrefix={testIdPrefix}
        />

        <div
          id={`${testIdPrefix}-panel`}
          data-testid={`${testIdPrefix}-panel`}
          role="tabpanel"
          aria-labelledby={activeRailId}
          className="flex flex-col gap-3 px-[18px] pb-[18px] pt-4 max-md:gap-3 max-md:px-3.5 max-md:py-3.5"
        >
          {masterMode ? (
            <div className="rounded-md border border-primary/30 bg-primary/10 px-2.5 py-2 text-[11px] leading-[1.45]">
              {t("workflow.masterBanner")}
            </div>
          ) : null}
          {!canEdit ? (
            <div className="rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-[11px] leading-[1.45]">
              {t("workflow.adminOnly")}
            </div>
          ) : null}
          {workflowInvalid ? (
            <div
              className="rounded-md border border-danger/40 bg-danger/10 px-2.5 py-2 text-[11px] leading-[1.45] text-danger"
              data-testid={`${testIdPrefix}-invalid`}
            >
              {t("workflow.error.invalidStored")}
            </div>
          ) : null}
          {foreignChange ? (
            <div
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-[11px] leading-[1.45]"
              data-testid={`${testIdPrefix}-foreign-change`}
            >
              <span>{t("workflow.foreignChange")}</span>
              <button
                type="button"
                onClick={reloadFromSaved}
                data-testid={`${testIdPrefix}-reload`}
                className="rounded border border-warning/40 px-2 py-0.5 text-[11px] text-foreground hover:bg-warning/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("workflow.reload")}
              </button>
            </div>
          ) : null}
          {validationError ? (
            <p
              className="flex items-center gap-1.5 rounded-md border border-danger/30 bg-danger/10 px-2.5 py-2 text-[11px] leading-[1.45] text-danger"
              data-testid={`${testIdPrefix}-error`}
              role="alert"
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {validationError}
            </p>
          ) : null}

          {view === "columns" ? (
            <div className="flex flex-col md:grid md:grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_316px]">
              <main className="flex min-w-0 flex-col gap-3.5">
                <TransitionList
                  columns={columns}
                  source={columns.find(
                    (column) => column.id === activeColumnId,
                  )}
                  transitions={controller.cleanDraft.transitions}
                  enabledCount={enabledForColumn}
                  canEdit={canEdit}
                  selectedId={controller.selectedId}
                  onSelect={openRule}
                  onToggle={setTransitionEnabled}
                  onAllow={allowDestination}
                  testIdPrefix={testIdPrefix}
                />
                <GlobalTransitions
                  columns={columns}
                  globals={globals}
                  targets={globalTargets}
                  canEdit={canEdit}
                  onSelect={openRule}
                  onAdd={(columnId) => {
                    addGlobal(columnId);
                    setInspectorOpen(true);
                  }}
                  testIdPrefix={testIdPrefix}
                />
                <ColumnSemantics
                  controller={controller}
                  testIdPrefix={testIdPrefix}
                />
              </main>
              <TransitionInspector
                controller={controller}
                testIdPrefix={testIdPrefix}
                open={inspectorOpen}
                onOpenChange={setInspectorOpen}
              />
            </div>
          ) : (
            <div className="flex flex-col md:grid md:grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_316px]">
              <main className="flex min-w-0 flex-col gap-2.5">
                <TransitionMatrix
                  controller={controller}
                  testIdPrefix={testIdPrefix}
                />
                <GlobalTransitions
                  columns={columns}
                  globals={globals}
                  targets={globalTargets}
                  canEdit={canEdit}
                  onSelect={openRule}
                  onAdd={(columnId) => {
                    addGlobal(columnId);
                    setInspectorOpen(true);
                  }}
                  testIdPrefix={testIdPrefix}
                />
                <ColumnSemantics
                  controller={controller}
                  testIdPrefix={testIdPrefix}
                />
              </main>
              <TransitionInspector
                controller={controller}
                testIdPrefix={testIdPrefix}
                open={inspectorOpen}
                onOpenChange={setInspectorOpen}
              />
            </div>
          )}
        </div>
      </div>

      {saveFailed ? (
        <div
          ref={saveErrorRef}
          role="alert"
          tabIndex={-1}
          data-testid={`${testIdPrefix}-save-error`}
          className="flex flex-wrap items-center justify-between gap-2 border-t border-danger/30 bg-danger/10 px-5 py-2 text-[11px] leading-[1.45] text-danger focus:outline-none max-md:px-3.5"
        >
          <span className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {statusHint}
          </span>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            data-testid={`${testIdPrefix}-retry`}
            className="rounded border border-danger/40 px-2 py-0.5 text-danger hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {t("workflow.retry")}
          </button>
        </div>
      ) : null}

      <footer className="flex shrink-0 items-center justify-between gap-3.5 border-t border-border/75 bg-[color-mix(in_oklab,var(--surface)_82%,var(--background))] px-5 py-[11px] max-md:flex-col max-md:items-stretch max-md:gap-2 max-md:px-3.5 max-md:pb-[max(10px,env(safe-area-inset-bottom))] max-md:pt-2.5">
        <div className="flex min-w-0 items-center gap-[7px] text-[11px] text-muted-foreground max-md:w-full">
          <span
            aria-hidden
            className={cn(
              "h-[5px] w-[5px] shrink-0 rounded-full",
              statusTone,
              !saving &&
                !saveFailed &&
                (dirty
                  ? "shadow-[0_0_0_3px_color-mix(in_oklab,var(--warning)_14%,transparent)]"
                  : "shadow-[0_0_0_3px_color-mix(in_oklab,var(--success)_14%,transparent)]"),
            )}
          />
          <span
            aria-live="polite"
            data-testid={`${testIdPrefix}-dirty`}
            className="truncate"
          >
            {statusText}
          </span>
          <span className="truncate border-l border-border pl-3 text-muted-foreground/75 max-md:hidden">
            {statusHint}
          </span>
        </div>
        <div className="flex flex-none items-center gap-1.5 max-md:w-full max-md:justify-end">
          {onCancel ? (
            <button
              type="button"
              onClick={requestCancel}
              disabled={saving}
              data-testid={`${testIdPrefix}-cancel`}
              className="inline-flex h-8 items-center justify-center rounded-md px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none"
            >
              {t("workflow.cancel")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={revert}
            disabled={!dirty || saving}
            data-testid={`${testIdPrefix}-revert`}
            className="inline-flex h-8 items-center justify-center rounded-md border border-transparent px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none"
          >
            {t("workflow.revert")}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!canEdit || saving || !dirty || validationError !== null}
            data-testid={`${testIdPrefix}-save`}
            className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-[inset_0_1px_rgba(255,255,255,0.16)] transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none"
          >
            {saving ? t("workflow.saving") : t("workflow.saveShort")}
          </button>
        </div>
      </footer>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={t("workflow.resetTitle")}
        description={t("workflow.resetDescription")}
        confirmLabel={t("workflow.reset")}
        destructive
        onConfirm={() => {
          setConfirmReset(false);
          void resetWorkflow();
        }}
      />

      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title={t("workflow.discardTitle")}
        description={t("workflow.discardDescription")}
        confirmLabel={t("workflow.discard")}
        destructive
        onConfirm={() => {
          setConfirmDiscard(false);
          onCancel?.();
        }}
      />
    </div>
  );
}
