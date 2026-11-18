import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Link2,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  LIMITS,
  isCardLinkType,
  linkedNeighbourIds,
  type BoardAction,
  type BoardAggregate,
  type CardLinkType,
} from "@janosik/shared";
import type { AdminCardDetailDto } from "@janosik/shared";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/Toast";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  isPairLinked,
  suggestLinkTargets,
  wouldCreateCycle,
} from "@/utils/links";
import { adminApi } from "./admin-client";
import { useAdminT, type AdminMessageKey } from "./admin-i18n";
import {
  Badge,
  ConfirmDialog,
  Field,
  OwnerAttributionNotice,
  Panel,
} from "./ui";

/**
 * TASK-176.9 (B2) — admin-native editing of checklists and card links.
 *
 * The normal `CardChecklists`/`CardLinks` editors require `BoardContext`,
 * which `/admin/*` never mounts. This panel therefore reuses the shared
 * command types, limits and link invariants, but renders its own controls and
 * sends one fresh owner-attributed command per change. Deleted rows are
 * filtered out of the editors; links keep deleted/dangling rows readable so a
 * master can still free a card that is stuck at the outgoing cap.
 */

type LinkDirection = "out" | "in";

type RelationAction =
  | { type: "ADD_CHECKLIST"; newChecklistId: string; title: string }
  | { type: "RENAME_CHECKLIST"; checklistId: string; title: string }
  | { type: "DELETE_CHECKLIST"; checklistId: string }
  | {
      type: "ADD_CHECKLIST_ITEM";
      checklistId: string;
      newItemId: string;
      text: string;
    }
  | {
      type: "SET_CHECKLIST_ITEM_DONE";
      checklistId: string;
      itemId: string;
      done: boolean;
    }
  | {
      type: "RENAME_CHECKLIST_ITEM";
      checklistId: string;
      itemId: string;
      text: string;
    }
  | {
      type: "DELETE_CHECKLIST_ITEM";
      checklistId: string;
      itemId: string;
    }
  | {
      type: "ADD_CARD_LINK";
      linkId: string;
      targetCardId: string;
      linkType: CardLinkType;
    }
  | {
      type: "REMOVE_CARD_LINK";
      linkId: string;
      targetCardId: string;
      linkType: CardLinkType;
    };

type LinkOption = {
  key: "relatesTo" | "blocks" | "blockedBy" | "duplicates" | "duplicatedBy";
  linkType: CardLinkType;
  holder: "source" | "target";
  labelKey: AdminMessageKey;
};

const LINK_OPTIONS: LinkOption[] = [
  {
    key: "relatesTo",
    linkType: "relates_to",
    holder: "source",
    labelKey: "admin.cards.relations.option.relatesTo",
  },
  {
    key: "blocks",
    linkType: "blocks",
    holder: "source",
    labelKey: "admin.cards.relations.option.blocks",
  },
  {
    key: "blockedBy",
    linkType: "blocks",
    holder: "target",
    labelKey: "admin.cards.relations.option.blockedBy",
  },
  {
    key: "duplicates",
    linkType: "duplicates",
    holder: "source",
    labelKey: "admin.cards.relations.option.duplicates",
  },
  {
    key: "duplicatedBy",
    linkType: "duplicates",
    holder: "target",
    labelKey: "admin.cards.relations.option.duplicatedBy",
  },
];

const cardHref = (id: string) => `/admin/cards/${id}`;

/** Keep `Date.now()` out of the component body for the React purity lint. */
const commandTimestamp = () => Date.now();

/**
 * The checklist/item editor. Local drafts live here so the parent keeps only
 * the busy key and the command boundary. Server data is the source of truth:
 * after a successful command the whole detail reloads and the draft closes.
 */
function ChecklistBlock({
  checklist,
  busy,
  onRename,
  onDelete,
  onAddItem,
  onToggleItem,
  onRenameItem,
  onDeleteItem,
  onError,
}: {
  checklist: AdminCardDetailDto["checklists"][number];
  busy: string | null;
  onRename: (title: string) => Promise<boolean>;
  onDelete: () => void;
  onAddItem: (text: string) => Promise<boolean>;
  onToggleItem: (itemId: string, done: boolean) => Promise<boolean>;
  onRenameItem: (itemId: string, text: string) => Promise<boolean>;
  onDeleteItem: (itemId: string) => Promise<boolean>;
  onError: (message: string) => void;
}) {
  const t = useAdminT();
  const items = useMemo(
    () => checklist.items.filter((item) => item.deletedAt === null),
    [checklist.items],
  );
  const done = items.filter((item) => item.done).length;
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(checklist.title);
  const [itemDraft, setItemDraft] = useState("");
  const [renamingItem, setRenamingItem] = useState<{
    id: string;
    text: string;
  } | null>(null);

  const titleValidation =
    titleDraft.trim() === ""
      ? t("admin.cards.relations.checklistTitleRequired")
      : titleDraft.length > LIMITS.checklistTitle
        ? t("admin.cards.relations.checklistTitleTooLong", {
            max: LIMITS.checklistTitle,
          })
        : null;
  const titleUnchanged = titleDraft.trim() === checklist.title.trim();

  const saveTitle = async (event: React.FormEvent) => {
    event.preventDefault();
    if (titleValidation !== null) {
      onError(titleValidation);
      return;
    }
    if (titleUnchanged) {
      setRenaming(false);
      return;
    }
    if (await onRename(titleDraft.trim())) setRenaming(false);
  };

  const addItem = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = itemDraft.trim();
    if (text === "") {
      onError(t("admin.cards.relations.itemRequired"));
      return;
    }
    if (text.length > LIMITS.checklistItem) {
      onError(
        t("admin.cards.relations.itemTooLong", { max: LIMITS.checklistItem }),
      );
      return;
    }
    if (items.length >= LIMITS.itemsPerChecklist) {
      onError(
        t("admin.cards.relations.itemsLimit", {
          limit: LIMITS.itemsPerChecklist,
        }),
      );
      return;
    }
    if (await onAddItem(text)) setItemDraft("");
  };

  const itemAtCap = items.length >= LIMITS.itemsPerChecklist;

  return (
    <div
      className="min-w-0 space-y-2 rounded-lg border border-border/70 bg-card/40 p-2.5"
      data-testid={`admin-checklist-row-${checklist.id}`}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {renaming ? (
          <form
            noValidate
            onSubmit={saveTitle}
            className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5"
            data-testid={`admin-checklist-rename-form-${checklist.id}`}
          >
            <Input
              value={titleDraft}
              maxLength={LIMITS.checklistTitle}
              autoFocus
              aria-label={t("admin.cards.relations.checklistTitle")}
              data-testid={`admin-checklist-rename-input-${checklist.id}`}
              onChange={(event) => setTitleDraft(event.target.value)}
              className="h-7 min-w-0 flex-1 text-xs"
            />
            <Button
              size="sm"
              type="submit"
              className="h-7 px-2 text-[11px]"
              disabled={busy !== null || titleValidation !== null}
              data-testid={`admin-checklist-rename-save-${checklist.id}`}
            >
              {t("admin.common.save")}
            </Button>
            <Button
              size="sm"
              type="button"
              variant="ghost"
              className="h-7 px-2 text-[11px]"
              disabled={busy !== null}
              data-testid={`admin-checklist-rename-cancel-${checklist.id}`}
              onClick={() => {
                setTitleDraft(checklist.title);
                setRenaming(false);
              }}
            >
              {t("admin.common.cancel")}
            </Button>
          </form>
        ) : (
          <>
            <p
              className="min-w-0 flex-1 break-words text-xs font-medium"
              data-testid={`admin-checklist-title-${checklist.id}`}
            >
              {checklist.title}
            </p>
            <span
              className="shrink-0 tabular-nums text-[11px] text-muted-foreground"
              data-testid={`admin-checklist-progress-${checklist.id}`}
            >
              {done}/{items.length}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-[11px]"
              disabled={busy !== null}
              aria-label={t("admin.cards.relations.renameChecklistLabel", {
                title: checklist.title,
              })}
              data-testid={`admin-checklist-rename-${checklist.id}`}
              onClick={() => {
                setTitleDraft(checklist.title);
                setRenaming(true);
              }}
            >
              {t("admin.common.rename")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-[11px] text-danger hover:bg-danger/10 hover:text-danger"
              disabled={busy !== null}
              aria-label={t("admin.cards.relations.deleteChecklistLabel", {
                title: checklist.title,
              })}
              data-testid={`admin-checklist-delete-${checklist.id}`}
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </>
        )}
      </div>

      {items.length === 0 ? (
        <p
          className="text-[11px] text-muted-foreground"
          data-testid={`admin-checklist-items-empty-${checklist.id}`}
        >
          {t("admin.cards.relations.itemsEmpty")}
        </p>
      ) : (
        <ul className="space-y-1">
          {items.map((item) => {
            const itemBusy = busy === `item:${item.id}`;
            const editing = renamingItem?.id === item.id;
            return (
              <li
                key={item.id}
                className="flex min-w-0 items-start gap-1.5"
                data-testid={`admin-checklist-item-row-${item.id}`}
              >
                <Checkbox
                  checked={item.done}
                  disabled={busy !== null}
                  aria-label={t("admin.cards.relations.toggleItemLabel", {
                    text: item.text,
                  })}
                  data-testid={`admin-checklist-item-toggle-${item.id}`}
                  onCheckedChange={(done) => {
                    if (done === item.done) return;
                    void onToggleItem(item.id, done);
                  }}
                  className="mt-0.5"
                />
                {editing ? (
                  <form
                    noValidate
                    className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      const text = renamingItem.text.trim();
                      if (text === "") {
                        onError(t("admin.cards.relations.itemRequired"));
                        return;
                      }
                      if (text.length > LIMITS.checklistItem) {
                        onError(
                          t("admin.cards.relations.itemTooLong", {
                            max: LIMITS.checklistItem,
                          }),
                        );
                        return;
                      }
                      if (text === item.text) {
                        setRenamingItem(null);
                        return;
                      }
                      if (await onRenameItem(item.id, text)) {
                        setRenamingItem(null);
                      }
                    }}
                  >
                    <Input
                      value={renamingItem.text}
                      maxLength={LIMITS.checklistItem}
                      autoFocus
                      aria-label={t("admin.cards.relations.itemText")}
                      data-testid={`admin-checklist-item-rename-input-${item.id}`}
                      onChange={(event) =>
                        setRenamingItem({
                          id: item.id,
                          text: event.target.value,
                        })
                      }
                      className="h-7 min-w-0 flex-1 text-xs"
                    />
                    <Button
                      size="sm"
                      type="submit"
                      className="h-7 px-2 text-[11px]"
                      disabled={busy !== null}
                      data-testid={`admin-checklist-item-rename-save-${item.id}`}
                    >
                      {t("admin.common.save")}
                    </Button>
                    <Button
                      size="sm"
                      type="button"
                      variant="ghost"
                      className="h-7 px-2 text-[11px]"
                      disabled={busy !== null}
                      data-testid={`admin-checklist-item-rename-cancel-${item.id}`}
                      onClick={() => setRenamingItem(null)}
                    >
                      {t("admin.common.cancel")}
                    </Button>
                  </form>
                ) : (
                  <>
                    <span
                      className={cn(
                        "min-w-0 flex-1 break-words text-xs",
                        item.done && "text-muted-foreground line-through",
                      )}
                      data-testid={`admin-checklist-item-text-${item.id}`}
                    >
                      {item.text}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5 text-[11px]"
                      disabled={busy !== null}
                      aria-label={t("admin.cards.relations.renameItemLabel", {
                        text: item.text,
                      })}
                      data-testid={`admin-checklist-item-rename-${item.id}`}
                      onClick={() =>
                        setRenamingItem({ id: item.id, text: item.text })
                      }
                    >
                      {t("admin.common.rename")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5 text-[11px] text-danger hover:bg-danger/10 hover:text-danger"
                      disabled={itemBusy || busy !== null}
                      aria-label={t("admin.cards.relations.deleteItemLabel", {
                        text: item.text,
                      })}
                      data-testid={`admin-checklist-item-delete-${item.id}`}
                      onClick={() => void onDeleteItem(item.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <form noValidate onSubmit={addItem} className="flex min-w-0 gap-1.5">
        <Input
          value={itemDraft}
          maxLength={LIMITS.checklistItem}
          aria-label={t("admin.cards.relations.newItem", {
            title: checklist.title,
          })}
          placeholder={t("admin.cards.relations.newItemPlaceholder")}
          data-testid={`admin-checklist-item-input-${checklist.id}`}
          disabled={busy !== null || itemAtCap}
          onChange={(event) => setItemDraft(event.target.value)}
          className="h-7 min-w-0 flex-1 text-xs"
        />
        <Button
          size="sm"
          type="submit"
          className="h-7 shrink-0 px-2 text-[11px]"
          disabled={busy !== null || itemAtCap || itemDraft.trim() === ""}
          data-testid={`admin-checklist-item-add-${checklist.id}`}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t("admin.common.add")}
        </Button>
      </form>
      {itemAtCap ? (
        <p className="text-[11px] text-muted-foreground">
          {t("admin.cards.relations.itemsLimit", {
            limit: LIMITS.itemsPerChecklist,
          })}
        </p>
      ) : null}
    </div>
  );
}

export function CardRelationsPanel({
  card,
  checklists,
  linksOut,
  linksIn,
  onSaved,
}: {
  card: AdminCardDetailDto["card"];
  checklists: AdminCardDetailDto["checklists"];
  linksOut: AdminCardDetailDto["linksOut"];
  linksIn: AdminCardDetailDto["linksIn"];
  onSaved: () => void;
}) {
  const t = useAdminT();
  const toast = useToast();
  const { lang } = useI18n();
  const targetListId = useId();

  const [board, setBoard] = useState<BoardAggregate | null>(null);
  const [boardError, setBoardError] = useState(false);
  const [boardLoading, setBoardLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const boardRequestRef = useRef(0);
  const mountedRef = useRef(true);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const targetInputRef = useRef<HTMLInputElement>(null);

  const [newChecklist, setNewChecklist] = useState("");
  const [confirmChecklist, setConfirmChecklist] = useState<
    AdminCardDetailDto["checklists"][number] | null
  >(null);

  const [linkOpen, setLinkOpen] = useState(false);
  const [linkQuery, setLinkQuery] = useState("");
  const [targetId, setTargetId] = useState<string | null>(null);
  const [linkOptionKey, setLinkOptionKey] =
    useState<LinkOption["key"]>("relatesTo");
  const [rawCursor, setCursor] = useState(0);

  /**
   * Load the board only when the link editor needs targets. Checklist/item
   * commands never touch this data, so they must not refetch it or reset the
   * link draft. Link commands do refetch: the target list, pair/cap/cycle
   * checks and dangling state all derive from the aggregate.
   */
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Invalidate an in-flight aggregate fetch: a late response must not set
      // state after the panel unmounted.
      boardRequestRef.current += 1;
    };
  }, []);

  const loadBoard = () => {
    // An async link command can finish after the panel unmounted; do not
    // start a fetch or enqueue state updates in that case.
    if (!mountedRef.current) return;
    const request = ++boardRequestRef.current;
    setBoardLoading(true);
    setBoardError(false);
    adminApi
      .getBoardContent(card.boardId)
      .then((next) => {
        if (!mountedRef.current || boardRequestRef.current !== request) return;
        setBoard(next);
        setBoardLoading(false);
      })
      .catch(() => {
        if (!mountedRef.current || boardRequestRef.current !== request) return;
        setBoardError(true);
        setBoardLoading(false);
      });
  };

  const openLinkForm = () => {
    setLinkOpen(true);
    if (board === null) loadBoard();
  };

  const closeLinkForm = () => {
    setLinkOpen(false);
    setTargetId(null);
    setLinkQuery("");
    setLinkOptionKey("relatesTo");
    setCursor(0);
    requestAnimationFrame(() =>
      openButtonRef.current?.focus({ preventScroll: true }),
    );
  };

  useEffect(() => {
    if (!linkOpen) return;
    targetInputRef.current?.focus({ preventScroll: true });
  }, [linkOpen]);

  const liveChecklists = useMemo(
    () => checklists.filter((checklist) => checklist.deletedAt === null),
    [checklists],
  );
  const checklistsAtCap = liveChecklists.length >= LIMITS.checklistsPerCard;

  const linkOption =
    LINK_OPTIONS.find((entry) => entry.key === linkOptionKey) ??
    LINK_OPTIONS[0];

  const suggestions = useMemo(() => {
    if (board === null) return [];
    const query = linkQuery.trim();
    if (query !== "") return suggestLinkTargets(board.cards, card.id, query, 8);
    const linked = linkedNeighbourIds(board.cards, card.id);
    return Object.values(board.cards)
      .filter(
        (entry) =>
          entry.id !== card.id &&
          entry.archivedAt === undefined &&
          !linked.has(entry.id),
      )
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, 8);
  }, [board, card.id, linkQuery]);

  // A query can shrink the list under the old cursor; clamp at render time
  // instead of syncing state from an effect.
  const cursor = Math.min(rawCursor, Math.max(0, suggestions.length - 1));

  const selectedTarget =
    board !== null && targetId !== null ? board.cards[targetId] : undefined;
  const holderId =
    selectedTarget === undefined
      ? null
      : linkOption.holder === "source"
        ? card.id
        : selectedTarget.id;
  const holder =
    holderId === null || board === null ? undefined : board.cards[holderId];

  // The cap belongs to the *holder* row. For the viewed card the detail DTO
  // is the freshest source (a checklist command must not touch it); for a
  // reverse option the holder is the target and the board aggregate owns it.
  const liveOutgoing = linksOut.filter((link) => link.deletedAt === null);
  const liveIncoming = linksIn.filter((link) => link.deletedAt === null);
  const holderOutgoingCount =
    holderId === card.id ? liveOutgoing.length : (holder?.links?.length ?? 0);
  const linkAtCap = holderOutgoingCount >= LIMITS.linksPerCard;
  const reverseHolder = holderId !== null && holderId !== card.id;
  // A reverse option stores the row on the target: the edge runs from the
  // target back to the viewed card, not from the target to itself.
  const otherEndId =
    holderId === null || selectedTarget === undefined
      ? null
      : holderId === card.id
        ? selectedTarget.id
        : card.id;
  const cycleBlocked =
    board !== null &&
    holderId !== null &&
    otherEndId !== null &&
    linkOption.linkType === "blocks" &&
    wouldCreateCycle(board.cards, holderId, otherEndId);

  const errorText = (cause: unknown, key: string): string => {
    if (cause instanceof ApiError) {
      if (cause.status === 403) return t("admin.common.forbidden");
      if (cause.code === "link_self") {
        return t("admin.cards.relations.errorSelf");
      }
      if (cause.code === "link_pair_exists") {
        return t("admin.cards.relations.errorPair");
      }
      if (cause.code === "link_cycle") {
        return t("admin.cards.relations.errorCycle");
      }
      if (cause.code === "link_cap") {
        return t("admin.cards.relations.errorCap", {
          limit: LIMITS.linksPerCard,
        });
      }
      if (cause.conflict === "wip") {
        if (key.startsWith("link:")) {
          return t("admin.cards.relations.errorCap", {
            limit: LIMITS.linksPerCard,
          });
        }
        if (key === "checklist:add") {
          return t("admin.cards.relations.checklistsLimit", {
            limit: LIMITS.checklistsPerCard,
          });
        }
        if (key.startsWith("item:add:")) {
          return t("admin.cards.relations.itemsLimit", {
            limit: LIMITS.itemsPerChecklist,
          });
        }
        return t("admin.cards.relations.errorConflict");
      }
      if (cause.status === 409) {
        if (cause.conflict === "id") {
          return t("admin.cards.relations.errorId");
        }
        return t("admin.cards.relations.errorConflict");
      }
      if (cause.status === 404) {
        return t("admin.cards.relations.errorNotFound");
      }
      if (cause.status === 400) {
        return t("admin.cards.relations.errorInvalid");
      }
      if (lang === "en" && cause.messageText) return cause.messageText;
    }
    return t("admin.common.actionFailed");
  };

  const send = async (
    key: string,
    action: RelationAction,
    successKey: AdminMessageKey,
    /** The holder for a link action; every other action edits this card. */
    holderCardId = card.id,
  ): Promise<boolean> => {
    if (busy !== null) return false;
    setBusy(key);
    setError(null);
    try {
      await adminApi.sendBoardCommand(card.boardId, {
        commandId: crypto.randomUUID(),
        action: {
          ...action,
          cardId: holderCardId,
          at: commandTimestamp(),
        } as BoardAction,
      });
      toast.success(t(successKey));
      onSaved();
      return true;
    } catch (cause) {
      setError(errorText(cause, key));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const addChecklist = async (event: React.FormEvent) => {
    event.preventDefault();
    const title = newChecklist.trim();
    if (title === "") {
      setError(t("admin.cards.relations.checklistTitleRequired"));
      return;
    }
    if (title.length > LIMITS.checklistTitle) {
      setError(
        t("admin.cards.relations.checklistTitleTooLong", {
          max: LIMITS.checklistTitle,
        }),
      );
      return;
    }
    if (checklistsAtCap) {
      setError(
        t("admin.cards.relations.checklistsLimit", {
          limit: LIMITS.checklistsPerCard,
        }),
      );
      return;
    }
    if (
      await send(
        "checklist:add",
        { type: "ADD_CHECKLIST", newChecklistId: crypto.randomUUID(), title },
        "admin.cards.relations.toast.checklistAdded",
      )
    ) {
      setNewChecklist("");
    }
  };

  const renameChecklist = async (
    checklistId: string,
    title: string,
  ): Promise<boolean> =>
    send(
      `checklist:rename:${checklistId}`,
      { type: "RENAME_CHECKLIST", checklistId, title },
      "admin.cards.relations.toast.checklistRenamed",
    );

  const deleteChecklist = async (
    checklist: AdminCardDetailDto["checklists"][number],
  ) => {
    setConfirmChecklist(null);
    await send(
      `checklist:delete:${checklist.id}`,
      { type: "DELETE_CHECKLIST", checklistId: checklist.id },
      "admin.cards.relations.toast.checklistDeleted",
    );
  };

  const addItem = async (checklistId: string, text: string): Promise<boolean> =>
    send(
      `item:add:${checklistId}`,
      {
        type: "ADD_CHECKLIST_ITEM",
        checklistId,
        newItemId: crypto.randomUUID(),
        text,
      },
      "admin.cards.relations.toast.itemAdded",
    );

  const toggleItem = async (
    checklistId: string,
    itemId: string,
    done: boolean,
  ): Promise<boolean> =>
    send(
      `item:${itemId}`,
      { type: "SET_CHECKLIST_ITEM_DONE", checklistId, itemId, done },
      done
        ? "admin.cards.relations.toast.itemChecked"
        : "admin.cards.relations.toast.itemUnchecked",
    );

  const renameItem = async (
    checklistId: string,
    itemId: string,
    text: string,
  ): Promise<boolean> =>
    send(
      `item:${itemId}`,
      { type: "RENAME_CHECKLIST_ITEM", checklistId, itemId, text },
      "admin.cards.relations.toast.itemRenamed",
    );

  const deleteItem = async (
    checklistId: string,
    itemId: string,
  ): Promise<boolean> =>
    send(
      `item:${itemId}`,
      { type: "DELETE_CHECKLIST_ITEM", checklistId, itemId },
      "admin.cards.relations.toast.itemDeleted",
    );

  const addLink = async (event: React.FormEvent) => {
    event.preventDefault();
    if (board === null || selectedTarget === undefined || holderId === null) {
      setError(t("admin.cards.relations.errorTargetRequired"));
      return;
    }
    if (selectedTarget.id === card.id) {
      setError(t("admin.cards.relations.errorSelf"));
      return;
    }
    if (isPairLinked(board.cards, card.id, selectedTarget.id)) {
      setError(t("admin.cards.relations.errorPair"));
      return;
    }
    if (linkAtCap) {
      setError(
        t("admin.cards.relations.errorCap", { limit: LIMITS.linksPerCard }),
      );
      return;
    }
    if (cycleBlocked) {
      setError(t("admin.cards.relations.errorCycle"));
      return;
    }
    const saved = await send(
      "link:add",
      {
        type: "ADD_CARD_LINK",
        linkId: crypto.randomUUID(),
        targetCardId: holderId === card.id ? selectedTarget.id : card.id,
        linkType: linkOption.linkType,
      },
      "admin.cards.relations.toast.linkAdded",
      holderId,
    );
    if (saved && mountedRef.current) {
      loadBoard();
      closeLinkForm();
    }
  };

  const removeLink = async (
    direction: LinkDirection,
    link: AdminCardDetailDto["linksOut"][number],
  ): Promise<boolean> => {
    if (!isCardLinkType(link.type)) return false;
    const holderCardId = direction === "out" ? card.id : link.otherCardId;
    const otherCardId = direction === "out" ? link.otherCardId : card.id;
    const saved = await send(
      `link:remove:${link.id}`,
      {
        type: "REMOVE_CARD_LINK",
        linkId: link.id,
        targetCardId: otherCardId,
        linkType: link.type,
      },
      "admin.cards.relations.toast.linkRemoved",
      holderCardId,
    );
    if (saved && mountedRef.current) loadBoard();
    return saved;
  };

  const canRemoveLink = (
    direction: LinkDirection,
    link: AdminCardDetailDto["linksOut"][number],
  ): boolean => {
    if (!isCardLinkType(link.type) || link.deletedAt !== null) return false;
    if (direction === "in") {
      // The row is stored on the other card; removing it needs that holder to
      // be live. The DTO flag lets us hide the action before the lazy board
      // aggregate is loaded.
      return !link.otherCardDeleted;
    }
    return true;
  };

  const relationPhrase = (direction: LinkDirection, type: string): string => {
    if (type === "blocks") {
      return direction === "out"
        ? t("admin.cards.relations.phrase.blocks")
        : t("admin.cards.relations.phrase.blockedBy");
    }
    if (type === "duplicates") {
      return direction === "out"
        ? t("admin.cards.relations.phrase.duplicates")
        : t("admin.cards.relations.phrase.duplicatedBy");
    }
    return t("admin.cards.relations.phrase.relatesTo");
  };

  const chooseTarget = (target: { id: string }) => {
    setTargetId(target.id);
    setLinkQuery("");
    setCursor(0);
    // Clicking/tabbing an option moves focus to the list button; put it back
    // on the combobox so the next keystroke keeps editing the target.
    targetInputRef.current?.focus({ preventScroll: true });
  };

  const handleTargetKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "ArrowDown") {
      if (suggestions.length === 0) return;
      event.preventDefault();
      setCursor((rawCursor + 1) % suggestions.length);
      return;
    }
    if (event.key === "ArrowUp") {
      if (suggestions.length === 0) return;
      event.preventDefault();
      setCursor((rawCursor - 1 + suggestions.length) % suggestions.length);
      return;
    }
    if (event.key === "Enter") {
      // Enter picks the highlighted target; with a selection already made
      // the form's own submit handles the command.
      if (targetId !== null) return;
      const hit = suggestions[cursor];
      if (hit !== undefined) {
        event.preventDefault();
        chooseTarget(hit);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (targetId !== null || linkQuery.trim() !== "") {
        setTargetId(null);
        setLinkQuery("");
        setCursor(0);
      } else {
        closeLinkForm();
      }
    }
  };

  const incomingCount = liveIncoming.length;
  const incomingCountLabel =
    incomingCount === 1 ||
    (lang === "ru" && incomingCount % 10 === 1 && incomingCount % 100 !== 11)
      ? t("admin.cards.relations.incomingCountOne", { count: incomingCount })
      : lang === "ru" &&
          [2, 3, 4].includes(incomingCount % 10) &&
          ![12, 13, 14].includes(incomingCount % 100)
        ? t("admin.cards.relations.incomingCountFew", { count: incomingCount })
        : t("admin.cards.relations.incomingCount", { count: incomingCount });

  const linkRows = [
    ...linksOut.map((link) => ({ direction: "out" as const, link })),
    ...linksIn.map((link) => ({ direction: "in" as const, link })),
  ];

  return (
    <Panel className="min-w-0 space-y-4 p-3" data-testid="admin-card-relations">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {t("admin.cards.relations.title")}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {t("admin.cards.relations.hint")}
        </p>
      </div>
      <OwnerAttributionNotice testId="admin-card-relations-owner-notice" />

      {error !== null ? (
        <p
          role="alert"
          data-testid="admin-card-relations-error"
          className="text-xs text-danger"
        >
          {error}
        </p>
      ) : null}

      <section
        className="min-w-0 space-y-2"
        data-testid="admin-card-detail-checklists"
        aria-label={t("admin.cards.relations.checklists")}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-medium text-muted-foreground">
            {t("admin.cards.relations.checklists")}
          </p>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {liveChecklists.length}/{LIMITS.checklistsPerCard}
          </span>
        </div>

        {liveChecklists.length === 0 ? (
          <p
            className="text-[11px] text-muted-foreground"
            data-testid="admin-card-checklists-empty"
          >
            {t("admin.cards.relations.checklistsEmpty")}
          </p>
        ) : (
          <div className="space-y-2">
            {liveChecklists.map((checklist) => (
              <ChecklistBlock
                key={checklist.id}
                checklist={checklist}
                busy={busy}
                onError={setError}
                onRename={(title) => renameChecklist(checklist.id, title)}
                onDelete={() => setConfirmChecklist(checklist)}
                onAddItem={(text) => addItem(checklist.id, text)}
                onToggleItem={(itemId, done) =>
                  toggleItem(checklist.id, itemId, done)
                }
                onRenameItem={(itemId, text) =>
                  renameItem(checklist.id, itemId, text)
                }
                onDeleteItem={(itemId) => deleteItem(checklist.id, itemId)}
              />
            ))}
          </div>
        )}

        <form
          noValidate
          onSubmit={addChecklist}
          className="flex min-w-0 flex-wrap items-center gap-1.5"
          data-testid="admin-new-checklist-form"
        >
          <Input
            value={newChecklist}
            maxLength={LIMITS.checklistTitle}
            aria-label={t("admin.cards.relations.newChecklist")}
            placeholder={t("admin.cards.relations.newChecklistPlaceholder")}
            data-testid="admin-new-checklist-title"
            disabled={busy !== null || checklistsAtCap}
            onChange={(event) => setNewChecklist(event.target.value)}
            className="h-8 min-w-0 flex-1 text-xs"
          />
          <Button
            size="sm"
            type="submit"
            className="h-8 shrink-0 px-2 text-[11px]"
            disabled={
              busy !== null || checklistsAtCap || newChecklist.trim() === ""
            }
            data-testid="admin-new-checklist-add"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t("admin.cards.relations.addChecklist")}
          </Button>
        </form>
        {checklistsAtCap ? (
          <p className="text-[11px] text-muted-foreground">
            {t("admin.cards.relations.checklistsLimit", {
              limit: LIMITS.checklistsPerCard,
            })}
          </p>
        ) : null}
      </section>

      <section
        className="min-w-0 space-y-2 border-t border-border pt-3"
        data-testid="admin-card-detail-links"
        aria-label={t("admin.cards.relations.links")}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-medium text-muted-foreground">
            {t("admin.cards.relations.links")}
          </p>
          <Button
            ref={openButtonRef}
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px]"
            data-testid="admin-card-link-open"
            aria-expanded={linkOpen}
            disabled={busy !== null}
            onClick={() => {
              if (linkOpen) closeLinkForm();
              else openLinkForm();
            }}
          >
            <Link2 className="h-3.5 w-3.5" aria-hidden />
            {t("admin.cards.relations.linkCard")}
          </Button>
        </div>

        {linkRows.length === 0 ? (
          <p
            className="text-[11px] text-muted-foreground"
            data-testid="admin-card-links-empty"
          >
            {t("admin.cards.relations.linksEmpty")}{" "}
            <button
              type="button"
              className="font-medium text-primary underline-offset-2 hover:underline"
              onClick={openLinkForm}
            >
              {t("admin.cards.relations.linkCard")}
            </button>
          </p>
        ) : (
          <ul className="min-w-0 space-y-1">
            {linkRows.map(({ direction, link }) => {
              const dangling = link.otherCardDeleted;
              const removable = canRemoveLink(direction, link);
              return (
                <li
                  key={`${direction}-${link.id}`}
                  className="flex min-w-0 flex-wrap items-center gap-1.5 rounded-md border border-border/60 px-2 py-1.5 text-xs"
                  data-testid={`admin-card-link-row-${link.id}`}
                  data-direction={direction}
                >
                  {direction === "out" ? (
                    <ArrowUpRight
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                  ) : (
                    <ArrowDownLeft
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                  )}
                  <span className="sr-only">
                    {direction === "out"
                      ? t("admin.cards.relations.outgoing")
                      : t("admin.cards.relations.incoming")}
                  </span>
                  <span className="rounded border border-border bg-hover/40 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                    {link.type}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {relationPhrase(direction, link.type)}
                  </span>
                  {dangling ? (
                    <span className="min-w-0 break-words font-medium text-muted-foreground">
                      {link.otherCardTitle}
                    </span>
                  ) : (
                    <Link
                      to={cardHref(link.otherCardId)}
                      className="min-w-0 break-words font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {link.otherCardTitle}
                    </Link>
                  )}
                  {dangling ? (
                    <Badge variant="warning">
                      {t("admin.cards.relations.dangling")}
                    </Badge>
                  ) : null}
                  {link.deletedAt !== null ? (
                    <Badge variant="danger">{t("admin.status.deleted")}</Badge>
                  ) : null}
                  {removable ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto h-6 shrink-0 px-1.5 text-[11px] text-danger hover:bg-danger/10 hover:text-danger"
                      disabled={busy !== null}
                      aria-label={t("admin.cards.relations.removeLinkLabel", {
                        title: link.otherCardTitle,
                      })}
                      data-testid={`admin-card-link-remove-${link.id}`}
                      onClick={() => void removeLink(direction, link)}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                      {t("admin.cards.relations.remove")}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span data-testid="admin-card-links-outgoing-count">
            {t("admin.cards.relations.outgoingCount", {
              count: liveOutgoing.length,
              limit: LIMITS.linksPerCard,
            })}
          </span>
          <span data-testid="admin-card-links-incoming-count">
            {incomingCountLabel}
          </span>
        </div>

        {linkOpen ? (
          <form
            noValidate
            onSubmit={addLink}
            className="min-w-0 space-y-2 rounded-lg border border-border/70 bg-card/40 p-2.5"
            data-testid="admin-card-link-form"
          >
            <div className="grid min-w-0 gap-2 sm:grid-cols-2">
              <Field
                htmlFor="admin-card-link-type"
                label={t("admin.cards.relations.relation")}
              >
                <select
                  id="admin-card-link-type"
                  data-testid="admin-card-link-type"
                  value={linkOptionKey}
                  disabled={busy !== null}
                  onChange={(event) =>
                    setLinkOptionKey(event.target.value as LinkOption["key"])
                  }
                  className="h-8 min-w-0 rounded-md border border-input bg-card px-2 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {LINK_OPTIONS.map((option) => (
                    <option key={option.key} value={option.key}>
                      {t(option.labelKey)}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                htmlFor="admin-card-link-target"
                label={t("admin.cards.relations.targetCard")}
              >
                <Input
                  ref={targetInputRef}
                  id="admin-card-link-target"
                  role="combobox"
                  aria-expanded={targetId === null && suggestions.length > 0}
                  aria-controls={targetListId}
                  aria-autocomplete="list"
                  aria-activedescendant={
                    targetId === null && suggestions.length > 0
                      ? `${targetListId}-option-${cursor}`
                      : undefined
                  }
                  data-testid="admin-card-link-target"
                  value={
                    selectedTarget === undefined
                      ? linkQuery
                      : selectedTarget.title
                  }
                  placeholder={t("admin.cards.relations.targetPlaceholder")}
                  disabled={busy !== null}
                  onChange={(event) => {
                    setTargetId(null);
                    setLinkQuery(event.target.value);
                    setCursor(0);
                  }}
                  onKeyDown={handleTargetKeyDown}
                  className="h-8 min-w-0 text-xs"
                />
              </Field>
            </div>

            {targetId === null && suggestions.length > 0 ? (
              <ul
                id={targetListId}
                role="listbox"
                aria-label={t("admin.cards.relations.targetSuggestions")}
                className="max-h-48 overflow-y-auto rounded-lg border border-border bg-popover p-1"
                data-testid="admin-card-link-suggestions"
              >
                {suggestions.map((suggestion, index) => (
                  <li key={suggestion.id} role="presentation">
                    <button
                      type="button"
                      id={`${targetListId}-option-${index}`}
                      role="option"
                      aria-selected={index === cursor}
                      className={cn(
                        "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs",
                        index === cursor
                          ? "bg-primary/10 text-primary"
                          : "hover:bg-hover",
                      )}
                      onMouseEnter={() => setCursor(index)}
                      data-testid={`admin-card-link-suggestion-${suggestion.id}`}
                      onClick={() => chooseTarget(suggestion)}
                    >
                      <Link2
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                      <span className="min-w-0 break-words">
                        {suggestion.title}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {selectedTarget !== undefined ? (
              <p
                className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground"
                data-testid="admin-card-link-selected"
              >
                <Check className="h-3.5 w-3.5 text-success" aria-hidden />
                {selectedTarget.title}
                <button
                  type="button"
                  className="text-primary underline-offset-2 hover:underline"
                  disabled={busy !== null}
                  onClick={() => {
                    setTargetId(null);
                    setLinkQuery("");
                    setCursor(0);
                    targetInputRef.current?.focus({ preventScroll: true });
                  }}
                >
                  {t("admin.common.clear")}
                </button>
              </p>
            ) : null}

            {boardError ? (
              <div className="flex flex-wrap items-center gap-2">
                <p
                  role="alert"
                  data-testid="admin-card-links-board-error"
                  className="text-[11px] text-danger"
                >
                  {t("admin.cards.relations.boardFailed")}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[11px]"
                  data-testid="admin-card-links-board-retry"
                  onClick={loadBoard}
                >
                  {t("admin.common.retry")}
                </Button>
              </div>
            ) : boardLoading || board === null ? (
              <p className="text-[11px] text-muted-foreground">
                {t("admin.cards.relations.boardLoading")}
              </p>
            ) : null}

            {reverseHolder && selectedTarget !== undefined ? (
              <p
                className={cn(
                  "text-[11px]",
                  linkAtCap ? "text-danger" : "text-muted-foreground",
                )}
                data-testid="admin-card-links-holder-cap"
              >
                {t("admin.cards.relations.holderCap", {
                  title: selectedTarget.title,
                  count: holderOutgoingCount,
                  limit: LIMITS.linksPerCard,
                })}
              </p>
            ) : null}

            {linkAtCap ? (
              <p
                className="text-[11px] text-muted-foreground"
                data-testid="admin-card-links-cap"
              >
                {t("admin.cards.relations.errorCap", {
                  limit: LIMITS.linksPerCard,
                })}
              </p>
            ) : null}
            {cycleBlocked ? (
              <p
                className="text-[11px] text-danger"
                data-testid="admin-card-link-cycle"
              >
                {t("admin.cards.relations.errorCycle")}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                type="submit"
                className="h-8 px-2 text-[11px]"
                data-testid="admin-card-link-add"
                disabled={
                  busy !== null ||
                  board === null ||
                  selectedTarget === undefined ||
                  linkAtCap ||
                  cycleBlocked
                }
              >
                <Link2 className="h-3.5 w-3.5" aria-hidden />
                {t("admin.cards.relations.linkCard")}
              </Button>
              <Button
                size="sm"
                type="button"
                variant="ghost"
                className="h-8 px-2 text-[11px]"
                data-testid="admin-card-link-cancel"
                disabled={busy !== null}
                onClick={closeLinkForm}
              >
                {t("admin.common.cancel")}
              </Button>
            </div>
          </form>
        ) : null}
      </section>

      <ConfirmDialog
        open={confirmChecklist !== null}
        title={t("admin.cards.relations.confirm.deleteChecklistTitle", {
          title: confirmChecklist?.title ?? "",
        })}
        body={t("admin.cards.relations.confirm.deleteChecklistBody")}
        confirmLabel={t("admin.cards.relations.delete")}
        busy={busy !== null}
        onConfirm={() => {
          if (confirmChecklist !== null) void deleteChecklist(confirmChecklist);
        }}
        onClose={() => setConfirmChecklist(null)}
      />
    </Panel>
  );
}
