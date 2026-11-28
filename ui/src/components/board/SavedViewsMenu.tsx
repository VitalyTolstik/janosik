import { Bookmark, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { useToast } from "@/components/Toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LimitCounter } from "@/components/ui/limit-counter";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n, type MessageKey } from "@/i18n";
import {
  createSavedView,
  isSavedViewProjection,
  loadSavedViews,
  MAX_SAVED_VIEWS,
  peekSavedViewsCount,
  pruneSavedViews,
  removeSavedView,
  renameSavedView,
  SAVED_VIEW_NAME_LIMIT,
  sanitizeSavedViews,
  saveSavedViews,
  type SavedView,
  type SavedViewError,
  type SavedViewProjection,
  type SavedViewsWriteError,
} from "@/utils/saved-views";
import { isFilterActive, type CardFilter } from "@/utils/filter";
import type { BoardView } from "./ViewSwitcher";

/**
 * Saved views menu (TASK-177.20.2) — local-only named filters.
 *
 * Mounted in `BoardSection` beside `FilterBar`. The wiring is deliberately
 * small and mirrors the calls below:
 *
 *   const members = useBoardMembersList(board.id);
 *   <SavedViewsMenu
 *     userId={user?.id ?? "local"}
 *     boardId={board.id}
 *     filter={filter}
 *     view={view}
 *     labels={board.labels}
 *     // undefined while the roster loads/fails — an empty array is treated
 *     // as "not loaded" so a loading board never prunes every assignee.
 *     assigneeIds={members.length > 0
 *       ? members.map((member) => member.userId)
 *       : undefined}
 *     onApply={(nextFilter, nextView) => {
 *       setFilter(nextFilter);          // one URL write, preserves ?card=
 *       if (nextView) setView(nextView);
 *     }}
 *   />
 *
 * Applying closes the popover and returns focus to the trigger; saved-view
 * drift/damage notices go through the app toast stack, not a stale panel.
 * `setFilter` in BoardSection uses `replace`, so applying a view adds no
 * history entry and never auto-restores on reload. `view` is optional in a
 * saved view; "watch" is never persisted.
 *
 * Keyboard pattern: every saved-view row exposes three explicit tab stops
 * (apply, rename, delete) — this is a list of actions, not a composite menu,
 * so there is no roving tabindex. Escape cancels an open form or delete
 * confirmation first; a second Escape closes the popover.
 */

const PROJECTION_LABEL: Record<SavedViewProjection, MessageKey> = {
  board: "view.board",
  calendar: "view.calendar",
  table: "view.table",
};

const ERROR_LABEL: Record<SavedViewError, MessageKey> = {
  "empty-filter": "savedViews.filterRequired",
  "invalid-name": "savedViews.nameRequired",
  duplicate: "savedViews.duplicate",
  limit: "savedViews.limit",
  "not-found": "savedViews.error",
};

const WRITE_ERROR_LABEL: Record<SavedViewsWriteError, MessageKey> = {
  storage: "savedViews.storageError",
  "newer-version": "savedViews.unsupported",
  corrupt: "savedViews.corruptLocked",
};

/** Keyed so a clean apply can clear the previous view's drift notice. */
const DRIFT_TOAST_KEY = "saved-views-drift";

/**
 * Filled actions need their own tokens: `--primary`/`--danger` are accent and
 * text tones, and white 12 px text on them measures 3.68:1 / 3.76:1 in dark.
 * `--action-*` is the AA-checked fill pair (5.17:1 / 6.47:1 with white).
 * The override is scoped here so the shared Button fill stays unchanged.
 */
const PRIMARY_ACTION_CLASS =
  "!bg-[var(--action-primary)] hover:!bg-[color-mix(in_oklab,var(--action-primary)_92%,#000)]";

type PanelError = SavedViewError | SavedViewsWriteError;
type Mode =
  { kind: "list" } | { kind: "create" } | { kind: "rename"; name: string };

export interface SavedViewsMenuProps {
  /** Current account id — views are namespaced per account. */
  userId: string;
  /** Current board id — views never travel between boards. */
  boardId: string;
  /** The filter currently applied to the board. */
  filter: CardFilter;
  /** The current projection; "watch" is omitted when saving. */
  view: BoardView;
  /** Board labels, used to prune deleted label ids on apply. */
  labels?: ReadonlyArray<{ id: string }>;
  /**
   * Board member ids once the roster loaded. Keep this undefined while the
   * roster is loading or failed; an empty array is also treated as unloaded
   * because a live board always contains at least the current user.
   */
  assigneeIds?: readonly string[];
  epicIds?: ReadonlySet<string>;
  /** Apply a stored view. The caller owns the URL/history write. */
  onApply: (filter: CardFilter, view?: SavedViewProjection) => void;
  /** Disable the trigger (e.g. while the board is unavailable). */
  disabled?: boolean;
}

export function SavedViewsMenu({
  userId,
  boardId,
  filter,
  view,
  labels,
  assigneeIds,
  epicIds,
  onApply,
  disabled = false,
}: SavedViewsMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  // The tooltip labels an icon-only trigger, but it must not survive the
  // click that opens the popover: it then hovers over the trigger and the
  // page header while the dialog is already covering the same area.
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const scope = `${userId}:${boardId}`;
  const peekedCount = useMemo(
    () => peekSavedViewsCount(userId, boardId),
    [userId, boardId],
  );
  const [countOverride, setCountOverride] = useState<{
    scope: string;
    count: number;
  } | null>(null);
  const count =
    countOverride?.scope === scope ? countOverride.count : peekedCount;
  const updateCount = useCallback(
    (next: number) => setCountOverride({ scope, count: next }),
    [scope],
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const label =
    count > 0 ? t("savedViews.menuCount", { count }) : t("savedViews.menu");

  const closeAndRestoreFocus = () => {
    setOpen(false);
    const focus = () => triggerRef.current?.focus();
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(focus);
    } else {
      window.setTimeout(focus, 0);
    }
  };

  return (
    <Tooltip
      open={open ? false : tooltipOpen}
      onOpenChange={(next) => {
        if (open) {
          setTooltipOpen(false);
          return;
        }
        setTooltipOpen(next);
      }}
    >
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setTooltipOpen(false);
        }}
      >
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              ref={triggerRef}
              variant="ghost"
              size="icon"
              aria-label={label}
              data-testid="saved-views-menu"
              disabled={disabled}
              className="shrink-0 text-muted-foreground transition-colors hover:bg-warning/25 hover:text-(--agent-tone-warning) max-lg:h-11 max-lg:w-11"
            >
              <span className="relative">
                <Bookmark className="h-5 w-5" aria-hidden />
                {count > 0 && (
                  <span
                    aria-hidden
                    className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-action-primary px-1 text-ui-micro font-semibold leading-none text-primary-foreground shadow-sm ring-2 ring-background"
                    data-testid="saved-views-count-badge"
                  >
                    {count}
                  </span>
                )}
              </span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <PopoverContent
          role="dialog"
          aria-label={t("savedViews.menu")}
          align="end"
          sideOffset={8}
          collisionPadding={8}
          onEscapeKeyDown={(event) => {
            // Escape first cancels an inline create/rename or delete
            // confirmation; only the next one closes the menu. The capture
            // listener would otherwise close it before the row sees the key.
            if (
              event.target instanceof Element &&
              event.target.closest(
                "[data-saved-view-editing], [data-saved-view-confirm]",
              ) !== null
            ) {
              event.preventDefault();
            }
          }}
          className="w-[min(24rem,calc(100vw_-_1rem))] p-0"
        >
          <SavedViewsPanel
            key={`${userId}:${boardId}`}
            userId={userId}
            boardId={boardId}
            filter={filter}
            view={view}
            labels={labels}
            assigneeIds={assigneeIds}
            epicIds={epicIds}
            onApply={onApply}
            onClose={closeAndRestoreFocus}
            onCountChange={updateCount}
          />
        </PopoverContent>
      </Popover>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function SavedViewsPanel({
  userId,
  boardId,
  filter,
  view,
  labels,
  assigneeIds,
  epicIds,
  onApply,
  onClose,
  onCountChange,
}: Omit<SavedViewsMenuProps, "disabled"> & {
  onClose: () => void;
  onCountChange: (count: number) => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [loaded] = useState(() => loadSavedViews(userId, boardId));
  const [views, setViews] = useState<SavedView[]>(loaded.views);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [draft, setDraft] = useState("");
  const [nameRequired, setNameRequired] = useState(false);
  const [error, setError] = useState<PanelError | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [writeLock, setWriteLock] = useState<SavedViewsWriteError | null>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const applyRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    onCountChange(views.length);
  }, [onCountChange, views.length]);

  const corruptNoCopy =
    loaded.status === "corrupt" && loaded.quarantineKey === null;
  const writeBlocked =
    writeLock !== null ||
    loaded.status === "unsupported" ||
    loaded.status === "unavailable" ||
    corruptNoCopy;
  const stateNotice =
    writeLock !== null
      ? t(WRITE_ERROR_LABEL[writeLock])
      : loaded.status === "unavailable"
        ? t("savedViews.unavailable")
        : loaded.status === "unsupported"
          ? t("savedViews.unsupported")
          : loaded.status === "corrupt"
            ? corruptNoCopy
              ? t("savedViews.corruptLocked")
              : t("savedViews.corrupt")
            : null;

  const filterActive = isFilterActive(filter);
  const atLimit = views.length >= MAX_SAVED_VIEWS;
  const createName = draft.trim();
  const createDuplicate =
    createName !== "" &&
    views.some(
      (saved) => saved.name.toLowerCase() === createName.toLowerCase(),
    );
  const canCreate =
    !writeBlocked &&
    filterActive &&
    !atLimit &&
    createName !== "" &&
    !createDuplicate;

  const renameName = draft.trim();
  const renameDuplicate =
    mode.kind === "rename" &&
    renameName !== "" &&
    views.some(
      (saved) =>
        saved.name !== mode.name &&
        saved.name.toLowerCase() === renameName.toLowerCase(),
    );
  const canRename =
    mode.kind === "rename" &&
    !writeBlocked &&
    renameName !== "" &&
    !renameDuplicate;
  const createNameError = createDuplicate
    ? t("savedViews.duplicate")
    : nameRequired
      ? t("savedViews.nameRequired")
      : null;
  const renameNameError = renameDuplicate
    ? t("savedViews.duplicate")
    : nameRequired
      ? t("savedViews.nameRequired")
      : null;

  /**
   * An empty member list is the pre-load/failure state, not "everyone was
   * removed": the current user is always a member of a live board. Skipping
   * the prune prevents a loading screen from deleting every assignee facet.
   */
  const knownAssigneeIds =
    assigneeIds === undefined || assigneeIds.length === 0
      ? undefined
      : assigneeIds;

  const focusSoon = (target: () => void) => {
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(target);
    } else {
      window.setTimeout(target, 0);
    }
  };
  const focusSaveButton = () =>
    focusSoon(() => {
      const button = saveButtonRef.current;
      if (button !== null && !button.disabled) button.focus();
      else panelRef.current?.focus();
    });
  const focusView = (name: string) =>
    focusSoon(() => {
      const target = applyRefs.current.get(name);
      if (target !== undefined) target.focus();
      else panelRef.current?.focus();
    });
  const setApplyRef = (name: string) => (element: HTMLButtonElement | null) => {
    if (element === null) applyRefs.current.delete(name);
    else applyRefs.current.set(name, element);
  };

  const errorText = (value: PanelError): string => {
    if (value === "limit") {
      return t("savedViews.limit", { count: MAX_SAVED_VIEWS });
    }
    if (
      value === "storage" ||
      value === "newer-version" ||
      value === "corrupt"
    ) {
      return t(WRITE_ERROR_LABEL[value]);
    }
    return t(ERROR_LABEL[value]);
  };

  const persist = (next: SavedView[]): SavedView[] | null => {
    const result = saveSavedViews(userId, boardId, next);
    if (!result.ok) {
      if (result.reason === "newer-version" || result.reason === "corrupt") {
        setWriteLock(result.reason);
      }
      setError(result.reason);
      return null;
    }
    setViews(result.views);
    setError(null);
    onCountChange(result.views.length);
    toast.clear(DRIFT_TOAST_KEY);
    return result.views;
  };

  const returnToList = (focusAfter: () => void) => {
    setMode({ kind: "list" });
    setDraft("");
    setNameRequired(false);
    setError(null);
    focusAfter();
  };
  const cancelCreate = () => returnToList(focusSaveButton);
  const cancelRename = (name: string) => returnToList(() => focusView(name));

  const openCreate = () => {
    setMode({ kind: "create" });
    setDraft("");
    setNameRequired(false);
    setError(null);
    setConfirmDelete(null);
  };

  const submitCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canCreate) {
      if (createName === "") setNameRequired(true);
      return;
    }
    const result = createSavedView(views, {
      name: draft,
      filter,
      view: isSavedViewProjection(view) ? view : undefined,
    });
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    if (persist(result.views) === null) return;
    returnToList(focusSaveButton);
  };

  const startRename = (saved: SavedView) => {
    setMode({ kind: "rename", name: saved.name });
    setDraft(saved.name);
    setNameRequired(false);
    setError(null);
    setConfirmDelete(null);
  };

  const updateFilters = (name: string) => {
    if (!filterActive || writeBlocked) return;
    const projection = isSavedViewProjection(view) ? view : undefined;
    const updated = views.map((saved) =>
      saved.name === name ? { name, filter, view: projection } : saved,
    );
    if (persist(updated) !== null) returnToList(() => focusView(name));
  };

  const submitRename = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mode.kind !== "rename") return;
    if (!canRename) {
      if (renameName === "") setNameRequired(true);
      return;
    }
    const result = renameSavedView(views, mode.name, draft);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    const saved = persist(result.views);
    if (saved === null) return;
    returnToList(() => focusView(result.view.name));
  };

  const deleteView = (name: string) => {
    const index = views.findIndex((saved) => saved.name === name);
    const nextName = views[index + 1]?.name ?? views[index - 1]?.name;
    const remaining = persist(removeSavedView(views, name));
    if (remaining === null) return;
    setConfirmDelete(null);
    if (nextName !== undefined && remaining.some((v) => v.name === nextName)) {
      focusView(nextName);
    } else {
      focusSaveButton();
    }
  };

  const cancelDelete = (name: string) => {
    setConfirmDelete(null);
    setError(null);
    focusView(name);
  };

  const applyView = (saved: SavedView) => {
    // Only the applied view is checked against the current board. Other saved
    // views may also have drifted, but they are left byte-for-byte alone until
    // the user applies them — an unrelated cleanup is not a user action.
    const pruned = pruneSavedViews([saved], {
      labelIds: labels?.map((label) => label.id),
      assigneeIds: knownAssigneeIds,
      epicIds: epicIds && [...epicIds],
    });
    const target = sanitizeSavedViews(pruned.views)[0];
    const dropped =
      pruned.droppedViewNames.includes(saved.name) || target === undefined;
    const changed = pruned.changedViewNames.includes(saved.name);

    if (dropped) {
      const remaining = removeSavedView(views, saved.name);
      if (persist(remaining) === null) return;
      toast.info(t("savedViews.droppedNotice", { name: saved.name }), {
        key: DRIFT_TOAST_KEY,
      });
      onClose();
      return;
    }

    if (target === undefined) return;
    if (changed) {
      const next = views.map((entry) =>
        entry.name === saved.name ? target : entry,
      );
      if (persist(next) === null) return;
      toast.info(t("savedViews.prunedNotice", { name: saved.name }), {
        key: DRIFT_TOAST_KEY,
      });
    } else {
      toast.clear(DRIFT_TOAST_KEY);
    }
    onApply(target.filter, target.view);
    onClose();
  };

  const cancelWithEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (mode.kind === "create") cancelCreate();
    else if (mode.kind === "rename") cancelRename(mode.name);
  };

  const confirmWithEscape = (
    event: KeyboardEvent<HTMLElement>,
    name: string,
  ) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    cancelDelete(name);
  };

  const projectionLabel = (saved: SavedView) =>
    saved.view === undefined
      ? t("savedViews.currentView")
      : t(PROJECTION_LABEL[saved.view]);

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      data-testid="saved-views-panel"
      className="outline-none"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border/60 px-3 py-2.5">
        <div className="min-w-0">
          <h2 className="text-ui-body font-semibold">{t("savedViews.menu")}</h2>
          <p className="mt-0.5 text-ui-label text-muted-foreground">
            {t("savedViews.localHint")}
          </p>
        </div>
        <span
          aria-label={t("savedViews.countLabel", {
            count: views.length,
            max: MAX_SAVED_VIEWS,
          })}
          title={t("savedViews.countLabel", {
            count: views.length,
            max: MAX_SAVED_VIEWS,
          })}
          className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-ui-micro tabular-nums text-muted-foreground"
        >
          {t("savedViews.count", {
            count: views.length,
            max: MAX_SAVED_VIEWS,
          })}
        </span>
      </div>

      <div className="space-y-2 px-3 pt-3">
        {stateNotice !== null && views.length > 0 && (
          <p
            role="status"
            data-testid="saved-views-notice"
            className="rounded-md border border-border/60 bg-muted/50 px-2 py-1.5 text-ui-body text-muted-foreground"
          >
            {stateNotice}
          </p>
        )}
        {error !== null && (
          <p
            role="alert"
            data-testid="saved-views-error"
            className="rounded-md border border-danger/40 bg-danger/10 px-2 py-1.5 text-ui-body text-(--chip-red)"
          >
            {errorText(error)}
          </p>
        )}

        {mode.kind === "create" ? (
          <form
            noValidate
            onSubmit={submitCreate}
            onKeyDown={cancelWithEscape}
            data-saved-view-editing
            className="space-y-2"
          >
            <label
              htmlFor="saved-view-name"
              className="block text-ui-label font-medium"
            >
              {t("savedViews.nameLabel")}
            </label>
            <Input
              id="saved-view-name"
              name="saved-view-name"
              autoFocus
              value={draft}
              maxLength={SAVED_VIEW_NAME_LIMIT}
              invalid={createNameError !== null}
              onChange={(event) => {
                setDraft(event.target.value);
                setNameRequired(false);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || canCreate) return;
                event.preventDefault();
                if (createName === "") setNameRequired(true);
              }}
              placeholder={t("savedViews.namePlaceholder")}
              aria-describedby={
                createNameError !== null ? "saved-view-name-error" : undefined
              }
              className="h-11"
              data-testid="saved-views-name"
            />
            <LimitCounter
              length={draft.length}
              limit={SAVED_VIEW_NAME_LIMIT}
              testId="saved-views-name-limit"
              dangerClassName="text-(--chip-red)"
            />
            {createNameError !== null && (
              <p
                id="saved-view-name-error"
                role="alert"
                className="text-ui-label text-(--chip-red)"
                data-testid={
                  createDuplicate
                    ? "saved-views-duplicate"
                    : "saved-views-name-required"
                }
              >
                {createNameError}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={!canCreate}
                className={`max-lg:h-11 ${PRIMARY_ACTION_CLASS}`}
                data-testid="saved-views-confirm-save"
              >
                {t("savedViews.save")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={cancelCreate}
                className="max-lg:h-11"
              >
                {t("savedViews.cancel")}
              </Button>
            </div>
          </form>
        ) : (
          <Button
            ref={saveButtonRef}
            type="button"
            variant="outline"
            onClick={openCreate}
            disabled={writeBlocked || !filterActive || atLimit}
            className="h-11 w-full justify-start gap-2"
            data-testid="saved-views-save-current"
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t("savedViews.saveCurrent")}
          </Button>
        )}
        {!filterActive && !writeBlocked && (
          <p className="text-ui-label text-muted-foreground">
            {t("savedViews.filterRequired")}
          </p>
        )}
        {atLimit && !writeBlocked && (
          <p className="text-ui-label text-muted-foreground">
            {t("savedViews.limit", { count: MAX_SAVED_VIEWS })}
          </p>
        )}
      </div>

      <div className="mt-3 max-h-[min(50vh,22rem)] overscroll-contain overflow-y-auto border-t border-border/60 p-2">
        {views.length === 0 ? (
          <p
            className="px-2 py-4 text-center text-ui-body text-muted-foreground"
            data-testid="saved-views-empty"
          >
            {stateNotice ?? t("savedViews.empty")}
          </p>
        ) : (
          <ul className="space-y-1" aria-label={t("savedViews.menu")}>
            {views.map((saved) => {
              const renaming =
                mode.kind === "rename" && mode.name === saved.name;
              const deleting = confirmDelete === saved.name;
              return (
                <li
                  key={saved.name}
                  data-view-name={saved.name}
                  className="relative flex min-h-11 items-center gap-1 rounded-lg border border-border/60 bg-card/40 p-1"
                >
                  {renaming ? (
                    <form
                      noValidate
                      onSubmit={submitRename}
                      onKeyDown={cancelWithEscape}
                      data-saved-view-editing
                      className="flex min-w-0 flex-1 flex-col gap-2 px-1 py-1"
                    >
                      <Input
                        autoFocus
                        value={draft}
                        maxLength={SAVED_VIEW_NAME_LIMIT}
                        invalid={renameNameError !== null}
                        onChange={(event) => {
                          setDraft(event.target.value);
                          setNameRequired(false);
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" || canRename) return;
                          event.preventDefault();
                          if (renameName === "") setNameRequired(true);
                        }}
                        onFocus={(event) => event.currentTarget.select()}
                        aria-label={t("savedViews.renameLabel", {
                          name: saved.name,
                        })}
                        aria-describedby={
                          renameNameError !== null
                            ? "saved-view-rename-error"
                            : undefined
                        }
                        className="h-11"
                        data-testid="saved-views-rename-input"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="min-h-11 self-start lg:min-h-8"
                        disabled={!filterActive || writeBlocked}
                        onClick={() => updateFilters(saved.name)}
                        data-testid="saved-views-update-filters"
                      >
                        {t("savedViews.useCurrentFilters")}
                      </Button>
                      {renameNameError !== null && (
                        <p
                          id="saved-view-rename-error"
                          role="alert"
                          className="text-ui-label text-(--chip-red)"
                          data-testid={
                            renameDuplicate
                              ? "saved-views-rename-duplicate"
                              : "saved-views-rename-required"
                          }
                        >
                          {renameNameError}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="submit"
                          size="sm"
                          disabled={!canRename}
                          className={`max-lg:h-11 ${PRIMARY_ACTION_CLASS}`}
                          data-testid="saved-views-confirm-rename"
                        >
                          {t("savedViews.renameSave")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => cancelRename(saved.name)}
                          className="max-lg:h-11"
                        >
                          {t("savedViews.cancel")}
                        </Button>
                      </div>
                    </form>
                  ) : deleting ? (
                    <div
                      data-saved-view-confirm
                      onKeyDown={(event) =>
                        confirmWithEscape(event, saved.name)
                      }
                      className="flex min-w-0 flex-1 items-center gap-1"
                    >
                      {/* Keep the row's identity visible; only the actions
                        become the compact confirm pair. The question stays in
                        the accessibility tree. */}
                      <span role="alert" className="sr-only">
                        {t("savedViews.deleteConfirm", { name: saved.name })}
                      </span>
                      <span className="box-border flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 pr-24 pl-2 lg:pr-[76px]">
                        <Bookmark
                          className="h-4 w-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-ui-body font-medium">
                            {saved.name}
                          </span>
                          <span className="block text-ui-meta text-muted-foreground">
                            {projectionLabel(saved)}
                          </span>
                        </span>
                      </span>
                      <div className="absolute right-1 top-1/2 flex shrink-0 -translate-y-1/2 items-center gap-0.5 rounded-xl border border-border/70 bg-background/60 p-0.5 shadow-sm">
                        <Button
                          autoFocus
                          type="button"
                          size="icon"
                          variant="ghost"
                          disabled={writeBlocked}
                          aria-label={t("savedViews.deleteConfirmAction", {
                            name: saved.name,
                          })}
                          onClick={() => deleteView(saved.name)}
                          className="h-11 w-11 rounded-lg text-danger hover:bg-danger/10 hover:text-danger lg:h-8 lg:w-8"
                          data-testid="saved-views-confirm-delete"
                        >
                          <Check className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={t("savedViews.cancel")}
                          title={t("savedViews.cancel")}
                          onClick={() => cancelDelete(saved.name)}
                          className="h-11 w-11 rounded-lg text-muted-foreground lg:h-8 lg:w-8"
                        >
                          <X className="h-4 w-4" aria-hidden />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        ref={setApplyRef(saved.name)}
                        type="button"
                        onClick={() => applyView(saved)}
                        title={saved.name}
                        data-saved-view-apply
                        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {/* WCAG 2.5.3: keep the visible name/projection inside
                          the accessible name, in order, and add the verb as
                          visually hidden content instead of an aria-label. */}
                        <span className="sr-only">
                          {t("savedViews.applyLabel")}
                        </span>{" "}
                        <Bookmark
                          className="h-4 w-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-ui-body font-medium">
                            {saved.name}
                          </span>{" "}
                          <span className="block text-ui-meta text-muted-foreground">
                            {projectionLabel(saved)}
                          </span>
                        </span>
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t("savedViews.renameAria", {
                          name: saved.name,
                        })}
                        onClick={() => startRename(saved)}
                        disabled={writeBlocked}
                        className="h-11 w-11 shrink-0 text-muted-foreground lg:h-8 lg:w-8"
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t("savedViews.deleteAria", {
                          name: saved.name,
                        })}
                        onClick={() => {
                          setConfirmDelete(saved.name);
                          setError(null);
                        }}
                        disabled={writeBlocked}
                        className="h-11 w-11 shrink-0 text-muted-foreground hover:text-danger lg:h-8 lg:w-8"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
