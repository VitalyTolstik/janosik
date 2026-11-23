import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { COMMAND_BATCH_MAX } from "@janosik/shared";

import { useToast } from "@/components/Toast";
import { useI18n } from "@/i18n";

/**
 * The selection ceiling matches the server's command batch ceiling: a bulk
 * action is still one command per card, but keeping the same number makes the
 * UI bound explicit and leaves room for a batched transport later.
 */
export const CARD_SELECTION_MAX = COMMAND_BATCH_MAX;

export interface CardSelectionValue {
  /** False for a VIEWER, an archived board, or a view without card rows. */
  enabled: boolean;
  /** Checkbox mode: a plain click toggles instead of opening the card. */
  mode: boolean;
  /** Selected card ids, in the order the user picked them. */
  selectedIds: readonly string[];
  selectedSet: ReadonlySet<string>;
  count: number;
  /** The cards the current view can offer, in visual order. */
  visibleIds: readonly string[];
  cap: number;
  setMode: (mode: boolean) => void;
  toggleMode: () => void;
  toggle: (cardId: string, shiftKey?: boolean) => void;
  selectAllVisible: () => void;
  clear: () => void;
  /** Replaces the selection (used after a bulk run to keep failures). */
  replace: (ids: readonly string[]) => void;
}

const EMPTY_SELECTION: CardSelectionValue = {
  enabled: false,
  mode: false,
  selectedIds: [],
  selectedSet: new Set<string>(),
  count: 0,
  visibleIds: [],
  cap: CARD_SELECTION_MAX,
  setMode: () => undefined,
  toggleMode: () => undefined,
  toggle: () => undefined,
  selectAllVisible: () => undefined,
  clear: () => undefined,
  replace: () => undefined,
};

const CardSelectionContext = createContext<CardSelectionValue | null>(null);

interface CardSelectionProviderProps {
  boardId: string;
  /** Visual card order: columns in board order, filtered where applicable. */
  order: readonly string[];
  enabled?: boolean;
  children: ReactNode;
}

function normalize(ids: readonly string[], allowed: ReadonlySet<string>) {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const id of ids) {
    if (!allowed.has(id) || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
    if (next.length >= CARD_SELECTION_MAX) break;
  }
  return next;
}

export function CardSelectionProvider({
  boardId,
  order,
  enabled = true,
  children,
}: CardSelectionProviderProps) {
  const { t } = useI18n();
  const toast = useToast();
  const [mode, setModeState] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Synchronous mirror for rapid handler loops (select-all + range): a
  // functional updater cannot show a toast when the cap is reached without
  // side effects inside the updater.
  const selectedRef = useRef<string[]>([]);
  // Range anchor for shift-click. A ref: it never affects rendering.
  const anchorRef = useRef<string | null>(null);
  const boardIdRef = useRef(boardId);

  // The id list is its own identity: a card edit rebuilds the board (and the
  // caller's array) without changing a single visible id. Re-deriving from
  // the key keeps the context value stable so memoized columns, rows and
  // cards do not re-render on every keystroke (TASK-21.4.1).
  const orderKey = order.join("\u0000");
  const stableOrder = useMemo(
    () => (orderKey === "" ? [] : orderKey.split("\u0000")),
    [orderKey],
  );
  const orderSet = useMemo(() => new Set(stableOrder), [stableOrder]);

  /* eslint-disable react-hooks/set-state-in-effect -- selection is
     transient UI state: a board switch or a surface turning read-only must
     discard it synchronously with the render that changed the context. */
  useEffect(() => {
    if (boardIdRef.current !== boardId) {
      boardIdRef.current = boardId;
      anchorRef.current = null;
      selectedRef.current = [];
      setSelectedIds([]);
      setModeState(false);
    }
  }, [boardId]);

  useEffect(() => {
    if (!enabled) {
      anchorRef.current = null;
      selectedRef.current = [];
      setModeState(false);
      setSelectedIds([]);
      return;
    }
    const pruned = selectedRef.current.filter((id) => orderSet.has(id));
    if (pruned.length !== selectedRef.current.length) {
      selectedRef.current = pruned;
      setSelectedIds(pruned);
    }
    if (anchorRef.current !== null && !orderSet.has(anchorRef.current)) {
      anchorRef.current = null;
    }
  }, [enabled, orderSet]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const commitSelected = useCallback((next: string[]) => {
    selectedRef.current = next;
    setSelectedIds(next);
  }, []);

  useEffect(() => {
    selectedRef.current = selectedIds;
  }, [selectedIds]);

  const setSelected = useCallback(
    (ids: readonly string[]) => {
      anchorRef.current = null;
      commitSelected(normalize(ids, orderSet));
    },
    [commitSelected, orderSet],
  );

  const clear = useCallback(() => {
    anchorRef.current = null;
    commitSelected([]);
    setModeState(false);
  }, [commitSelected]);

  const setMode = useCallback(
    (next: boolean) => {
      if (!enabled) return;
      setModeState(next);
      if (!next) {
        // The toggle and the bar say the same thing: pressed = a selection
        // may exist. Turning Select off therefore clears it instead of
        // leaving an unpressed toggle above a live bulk bar.
        anchorRef.current = null;
        commitSelected([]);
      }
    },
    [commitSelected, enabled],
  );

  const toggleMode = useCallback(() => setMode(!mode), [mode, setMode]);

  const toggle = useCallback(
    (cardId: string, shiftKey = false) => {
      if (!enabled || !orderSet.has(cardId)) return;

      if (shiftKey && anchorRef.current !== null) {
        const from = stableOrder.indexOf(anchorRef.current);
        const to = stableOrder.indexOf(cardId);
        if (from !== -1 && to !== -1) {
          const range = stableOrder.slice(
            Math.min(from, to),
            Math.max(from, to) + 1,
          );
          const current = selectedRef.current;
          const next = new Set(current);
          let capped = false;
          for (const id of range) {
            if (next.has(id)) continue;
            if (next.size >= CARD_SELECTION_MAX) {
              capped = true;
              break;
            }
            next.add(id);
          }
          if (capped) {
            toast.error(t("bulk.capReached", { count: CARD_SELECTION_MAX }));
          }
          if (next.size !== current.length) {
            commitSelected([...next]);
          }
          return;
        }
      }

      const current = selectedRef.current;
      if (current.includes(cardId)) {
        anchorRef.current = cardId;
        commitSelected(current.filter((id) => id !== cardId));
        return;
      }
      if (current.length >= CARD_SELECTION_MAX) {
        toast.error(t("bulk.capReached", { count: CARD_SELECTION_MAX }));
        return;
      }
      anchorRef.current = cardId;
      commitSelected([...current, cardId]);
    },
    [commitSelected, enabled, stableOrder, orderSet, t, toast],
  );

  const selectAllVisible = useCallback(() => {
    if (!enabled) return;
    if (stableOrder.length === 0) {
      toast.info(t("bulk.noCards"));
      return;
    }
    const next = stableOrder.slice(0, CARD_SELECTION_MAX);
    if (stableOrder.length > CARD_SELECTION_MAX) {
      toast.error(t("bulk.capReached", { count: CARD_SELECTION_MAX }));
    }
    setSelected(next);
  }, [enabled, stableOrder, setSelected, t, toast]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const value = useMemo<CardSelectionValue>(
    () => ({
      enabled,
      mode,
      selectedIds,
      selectedSet,
      count: selectedIds.length,
      visibleIds: stableOrder,
      cap: CARD_SELECTION_MAX,
      setMode,
      toggleMode,
      toggle,
      selectAllVisible,
      clear,
      replace: setSelected,
    }),
    [
      enabled,
      mode,
      selectedIds,
      selectedSet,
      stableOrder,
      setMode,
      toggleMode,
      toggle,
      selectAllVisible,
      clear,
      setSelected,
    ],
  );

  return (
    <CardSelectionContext.Provider value={value}>
      {children}
    </CardSelectionContext.Provider>
  );
}

/**
 * A safe no-op outside the provider keeps card-level components usable in
 * isolation (existing unit tests, embedded previews) without a second
 * selection implementation.
 */
export function useCardSelection(): CardSelectionValue {
  return useContext(CardSelectionContext) ?? EMPTY_SELECTION;
}
