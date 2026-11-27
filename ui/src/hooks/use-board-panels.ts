import { useEffect, useMemo, useState } from "react";

import { useMediaQuery } from "@/hooks/use-media-query";
import {
  boardPanelKey,
  clampRightWidth,
  readBoardPanels,
  RIGHT_PANEL_DEFAULT,
  RIGHT_PANEL_WIDE_DEFAULT,
  writeBoardPanels,
  type BoardPanelPrefs,
  type InspectorTab,
} from "@/utils/board-panel-storage";

const RESIZE_WRITE_DELAY = 200;

// Each board owns its pending snapshot. Flush on navigation so a fast
// board switch can't discard the last resize or write it to the next board.
function createPanelWriter(key: string | undefined) {
  let pending: BoardPanelPrefs | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(timer);
    if (key && pending) writeBoardPanels(key, pending);
    pending = undefined;
  };
  return {
    flush,
    schedule(prefs: BoardPanelPrefs, immediate: boolean) {
      clearTimeout(timer);
      pending = prefs;
      if (immediate) flush();
      else timer = setTimeout(flush, RESIZE_WRITE_DELAY);
    },
  };
}

export function useBoardPanels(userId: string, boardId: string | undefined) {
  const docked = useMediaQuery("(min-width: 1440px)");
  const sheet = !useMediaQuery("(min-width: 768px)");
  const wide = useMediaQuery("(min-width: 1920px)");
  const defaultWidth = wide ? RIGHT_PANEL_WIDE_DEFAULT : RIGHT_PANEL_DEFAULT;
  const key =
    boardId === undefined ? undefined : boardPanelKey(userId, boardId);
  const stored = useMemo(() => (key ? readBoardPanels(key) : undefined), [key]);
  const [state, setState] = useState(() => ({
    key,
    open: docked && stored?.right.open === true,
    openedInDock: docked && stored?.right.open === true,
    width: stored?.right.width,
    tab: stored?.right.tab ?? "people",
  }));
  if (state.key !== key) {
    setState({
      key,
      open: docked && stored?.right.open === true,
      openedInDock: docked && stored?.right.open === true,
      width: stored?.right.width,
      tab: stored?.right.tab ?? state.tab,
    });
  } else if (docked && state.open && !state.openedInDock) {
    setState({ ...state, openedInDock: true });
  }

  const writer = useMemo(() => createPanelWriter(key), [key]);
  useEffect(() => writer.flush, [writer]);

  const width = state.width ?? defaultWidth;
  function persist(
    right: { open: boolean; width: number; tab: InspectorTab },
    immediate: boolean,
  ) {
    writer.schedule(
      {
        version: 1,
        right: { ...right, open: docked && right.open },
        left: stored?.left ?? { open: false, width: 280 },
      },
      immediate,
    );
  }

  return {
    mode: docked
      ? ("dock" as const)
      : sheet
        ? ("sheet" as const)
        : ("drawer" as const),
    open: state.open,
    width,
    defaultWidth,
    tab: state.tab,
    setOpen(open: boolean, tab = state.tab) {
      if (open === state.open && tab === state.tab) return;
      setState({ ...state, open, tab, openedInDock: open && docked });
      // Modal opens must never become restored docked opens.
      if (docked || tab !== state.tab || (!open && state.openedInDock)) {
        persist({ open, width, tab }, true);
      } else if (!open) writer.flush();
    },
    setWidth(value: number) {
      const nextWidth = clampRightWidth(value, defaultWidth);
      if (nextWidth === width) return;
      setState((previous) => ({ ...previous, width: nextWidth }));
      persist({ open: state.open, width: nextWidth, tab: state.tab }, false);
    },
    setTab(tab: InspectorTab) {
      if (tab === state.tab) return;
      setState({ ...state, tab });
      persist({ open: state.open, width, tab }, true);
    },
  };
}
