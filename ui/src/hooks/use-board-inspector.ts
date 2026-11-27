import { createContext, useContext, type RefObject } from "react";

import type { useBoardPanels } from "@/hooks/use-board-panels";
import type { InspectorTab } from "@/utils/board-panel-storage";

export const BOARD_INSPECTOR_ID = "board-inspector";

export function inspectorTabId(tab: InspectorTab) {
  return `inspector-tab-${tab}`;
}

export function inspectorPanelId(tab: InspectorTab) {
  return `inspector-panel-${tab}`;
}

type InspectorControls = ReturnType<typeof useBoardPanels> & {
  dragging: boolean;
  cardOpen: boolean;
  triggerRef: RefObject<HTMLButtonElement>;
  tabRef: RefObject<HTMLButtonElement>;
  focusOnOpen: (container?: HTMLElement) => void;
  close: () => void;
  showCard: () => void;
  toggle: (keyboard: boolean) => boolean;
};

export const InspectorContext = createContext<InspectorControls | null>(null);
export const DragContext = createContext<
  ((dragging: boolean) => void) | undefined
>(undefined);

export function useBoardInspector() {
  return useContext(InspectorContext);
}

export function useInspectorDragChange() {
  return useContext(DragContext);
}
