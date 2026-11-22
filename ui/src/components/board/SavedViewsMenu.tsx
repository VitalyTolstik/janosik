import { Bookmark, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent, type KeyboardEvent } from "react";

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
  pruneSavedViews,
  removeSavedView,
  renameSavedView,
  SAVED_VIEW_NAME_LIMIT,
  saveSavedViews,
  type SavedView,
  type SavedViewError,
  type SavedViewProjection,
} from "@/utils/saved-views";
import { isFilterActive, type CardFilter } from "@/utils/filter";
import type { BoardView } from "./ViewSwitcher";

/**
 * Saved views menu (TASK-177.20.2) — local-only named filters.
 *
 * The component is preparatory and is intentionally **not mounted yet**;
 * 177.19 is still touching BoardSection/FilterBar. Integration note:
 *
 *   <SavedViewsMenu
 *     userId={user.id}
 *     boardId={board.id}
 *     filter={filter}
 *     view={view}
 *     labels={board.labels}
 *     assigneeIds={members.map((member) => member.userId)}
 *     onApply={(nextFilter, nextView) => {
 *       setFilter(nextFilter);          // one URL write, preserves ?card=
 *       if (nextView) setView(nextView);
 *     }}
 *   />
 *
 * `setFilter` in BoardSection uses `replace`, so applying a view adds no
 * history entry and never auto-restores on reload. `view` is optional in a
 * saved view; "watch" is never persisted.
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

type PanelError = SavedViewError | "storage";
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
  /** Board member ids, used to prune removed assignees on apply. */
  assigneeIds?: readonly string[];
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
  onApply,
  disabled = false,
}: SavedViewsMenuProps) {
  const { t } = useI18n();
  return (
    <Tooltip>
      <Popover>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("savedViews.menu")}
              data-testid="saved-views-menu"
              disabled={disabled}
              className="shrink-0 text-muted-foreground hover:text-foreground max-lg:h-11 max-lg:w-11"
            >
              <Bookmark className="h-5 w-5" aria-hidden />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <PopoverContent
          role="dialog"
          aria-label={t("savedViews.menu")}
          align="end"
          sideOffset={8}
          onEscapeKeyDown={(event) => {
            // Escape first cancels an inline create/rename; only the next one
            // closes the menu (the capture listener would otherwise close it
            // before the form sees the key).
            if (
              event.target instanceof Element &&
              event.target.closest("[data-saved-view-editing]") !== null
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
            onApply={onApply}
          />
        </PopoverContent>
      </Popover>
      <TooltipContent>{t("savedViews.menu")}</TooltipContent>
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
  onApply,
}: Omit<SavedViewsMenuProps, "disabled">) {
  const { t } = useI18n();
  const [loaded] = useState(() => loadSavedViews(userId, boardId));
  const [views, setViews] = useState<SavedView[]>(loaded.views);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<PanelError | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(() => {
    if (loaded.status === "corrupt") return t("savedViews.corrupt");
    if (loaded.status === "unsupported") return t("savedViews.unsupported");
    return null;
  });

  const locked = loaded.status === "unsupported";
  const filterActive = isFilterActive(filter);
  const atLimit = views.length >= MAX_SAVED_VIEWS;
  const createName = draft.trim();
  const createDuplicate =
    createName !== "" &&
    views.some(
      (saved) => saved.name.toLowerCase() === createName.toLowerCase(),
    );
  const canCreate =
    !locked &&
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
    mode.kind === "rename" && !locked && renameName !== "" && !renameDuplicate;

  const errorText = (value: PanelError): string => {
    if (value === "storage") return t("savedViews.storageError");
    if (value === "limit") {
      return t("savedViews.limit", { count: MAX_SAVED_VIEWS });
    }
    return t(ERROR_LABEL[value]);
  };

  const persist = (next: SavedView[]): boolean => {
    setViews(next);
    const ok = saveSavedViews(userId, boardId, next);
    setError(ok ? null : "storage");
    return ok;
  };

  const openCreate = () => {
    setMode({ kind: "create" });
    setDraft("");
    setError(null);
    setConfirmDelete(null);
  };

  const cancelEditing = () => {
    setMode({ kind: "list" });
    setDraft("");
    setError(null);
  };

  const submitCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canCreate) return;
    const result = createSavedView(views, {
      name: draft,
      filter,
      view: isSavedViewProjection(view) ? view : undefined,
    });
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    const saved = persist(result.views);
    cancelEditing();
    if (!saved) setError("storage");
  };

  const startRename = (saved: SavedView) => {
    setMode({ kind: "rename", name: saved.name });
    setDraft(saved.name);
    setError(null);
    setConfirmDelete(null);
  };

  const submitRename = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mode.kind !== "rename" || !canRename) return;
    const result = renameSavedView(views, mode.name, draft);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    const saved = persist(result.views);
    cancelEditing();
    if (!saved) setError("storage");
  };

  const deleteView = (name: string) => {
    persist(removeSavedView(views, name));
    setConfirmDelete(null);
    if (mode.kind === "rename" && mode.name === name) cancelEditing();
  };

  const applyView = (saved: SavedView) => {
    const pruned = pruneSavedViews(views, {
      labelIds: labels?.map((label) => label.id),
      assigneeIds,
    });
    const applied =
      pruned.views.find((entry) => entry.name === saved.name) ?? saved;
    if (pruned.missingOptions) {
      setViews(pruned.views);
      setNotice(t("savedViews.missingOptions"));
      if (!saveSavedViews(userId, boardId, pruned.views)) {
        setError("storage");
      }
    }
    onApply(applied.filter, applied.view);
  };

  const cancelWithEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    cancelEditing();
  };

  return (
    <div data-testid="saved-views-panel">
      <div className="flex items-start justify-between gap-3 border-b border-border/60 px-3 py-2.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{t("savedViews.menu")}</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {t("savedViews.localHint")}
          </p>
        </div>
        <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">
          {t("savedViews.count", {
            count: views.length,
            max: MAX_SAVED_VIEWS,
          })}
        </span>
      </div>

      <div className="space-y-2 px-3 pt-3">
        {notice !== null && (
          <p
            role="status"
            data-testid="saved-views-notice"
            className="rounded-md border border-border/60 bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground"
          >
            {notice}
          </p>
        )}
        {error !== null && (
          <p
            role="alert"
            data-testid="saved-views-error"
            className="rounded-md border border-danger/40 bg-danger/10 px-2 py-1.5 text-xs text-danger"
          >
            {errorText(error)}
          </p>
        )}

        {mode.kind === "create" ? (
          <form
            onSubmit={submitCreate}
            onKeyDown={cancelWithEscape}
            data-saved-view-editing
            className="space-y-2"
          >
            <label
              htmlFor="saved-view-name"
              className="block text-xs font-medium"
            >
              {t("savedViews.nameLabel")}
            </label>
            <Input
              id="saved-view-name"
              name="saved-view-name"
              autoFocus
              value={draft}
              maxLength={SAVED_VIEW_NAME_LIMIT}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t("savedViews.namePlaceholder")}
              aria-describedby={
                createDuplicate ? "saved-view-name-error" : undefined
              }
              className="h-11"
              data-testid="saved-views-name"
            />
            <LimitCounter
              length={draft.length}
              limit={SAVED_VIEW_NAME_LIMIT}
              testId="saved-views-name-limit"
            />
            {createDuplicate && (
              <p
                id="saved-view-name-error"
                className="text-xs text-danger"
                data-testid="saved-views-duplicate"
              >
                {t("savedViews.duplicate")}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={!canCreate}
                className="max-lg:h-11"
                data-testid="saved-views-confirm-save"
              >
                {t("savedViews.save")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={cancelEditing}
                className="max-lg:h-11"
              >
                {t("savedViews.cancel")}
              </Button>
            </div>
          </form>
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={openCreate}
            disabled={locked || !filterActive || atLimit}
            className="h-11 w-full justify-start gap-2"
            data-testid="saved-views-save-current"
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t("savedViews.saveCurrent")}
          </Button>
        )}
        {!filterActive && (
          <p className="text-[11px] text-muted-foreground">
            {t("savedViews.filterRequired")}
          </p>
        )}
        {atLimit && (
          <p className="text-[11px] text-muted-foreground">
            {t("savedViews.limit", { count: MAX_SAVED_VIEWS })}
          </p>
        )}
      </div>

      <div className="mt-3 max-h-[min(50vh,22rem)] overflow-y-auto border-t border-border/60 p-2">
        {views.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            {t("savedViews.empty")}
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
                  className="flex min-h-11 items-center gap-1 rounded-lg border border-border/60 bg-card/40 p-1"
                >
                  {renaming ? (
                    <form
                      onSubmit={submitRename}
                      onKeyDown={cancelWithEscape}
                      data-saved-view-editing
                      className="flex min-w-0 flex-1 flex-col gap-2 px-1 py-1"
                    >
                      <Input
                        autoFocus
                        value={draft}
                        maxLength={SAVED_VIEW_NAME_LIMIT}
                        onChange={(event) => setDraft(event.target.value)}
                        aria-label={t("savedViews.renameLabel", {
                          name: saved.name,
                        })}
                        className="h-11"
                        data-testid="saved-views-rename-input"
                      />
                      {renameDuplicate && (
                        <p className="text-xs text-danger">
                          {t("savedViews.duplicate")}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="submit"
                          size="sm"
                          disabled={!canRename}
                          className="max-lg:h-11"
                          data-testid="saved-views-confirm-rename"
                        >
                          {t("savedViews.renameSave")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={cancelEditing}
                          className="max-lg:h-11"
                        >
                          {t("savedViews.cancel")}
                        </Button>
                      </div>
                    </form>
                  ) : deleting ? (
                    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2 px-1 py-1">
                      <span className="truncate text-sm">
                        {t("savedViews.deleteConfirm")}
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={() => deleteView(saved.name)}
                          className="h-11 lg:h-8"
                          data-testid="saved-views-confirm-delete"
                        >
                          {t("savedViews.delete")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirmDelete(null)}
                          className="h-11 lg:h-8"
                        >
                          {t("savedViews.cancel")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => applyView(saved)}
                        aria-label={t("savedViews.applyAria", {
                          name: saved.name,
                        })}
                        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Bookmark
                          className="h-4 w-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {saved.name}
                          </span>
                          {saved.view !== undefined && (
                            <span className="block text-[11px] text-muted-foreground">
                              {t(PROJECTION_LABEL[saved.view])}
                            </span>
                          )}
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
                        disabled={locked}
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
                        disabled={locked}
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
