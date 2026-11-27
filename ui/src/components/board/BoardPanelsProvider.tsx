import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { useMatch, useSearchParams } from "react-router-dom";

import { isApiEnabled } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import {
  BOARD_INSPECTOR_ID,
  DragContext,
  InspectorContext,
} from "@/hooks/use-board-inspector";
import { useBoardPanels } from "@/hooks/use-board-panels";
import { routes } from "@/routes";
import { isEditableTarget } from "@/utils/keyboard";
import { findOpenOverlay } from "@/utils/overlay";

export function BoardPanelsProvider({
  boardId,
  children,
}: PropsWithChildren<{ boardId?: string }>) {
  const route = useMatch(routes.boardPattern);
  const { user } = useAuth();
  const [params] = useSearchParams();
  const enabled = Boolean(boardId && route && user && isApiEnabled());
  const panels = useBoardPanels(
    user?.id ?? "local",
    enabled ? boardId : undefined,
  );
  const { mode, open, setOpen } = panels;
  const [dragging, setDragging] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tabRef = useRef<HTMLButtonElement>(null);
  const focusTabOnOpen = useRef(false);
  const cardOpen = Boolean(params.get("card"));
  const closeForCard = cardOpen && mode === "sheet" && open;

  useEffect(() => {
    if (closeForCard) setOpen(false);
  }, [closeForCard, setOpen]);

  const close = () => {
    if (dragging) return;
    setOpen(false);
    if (mode === "dock") triggerRef.current?.focus();
  };
  const showCard = () => {
    if (dragging || cardOpen) return;
    focusTabOnOpen.current = true;
    setOpen(true, "card");
  };
  const toggle = (keyboard: boolean) => {
    if (dragging || cardOpen) return false;
    const overlay = findOpenOverlay();
    if (
      overlay &&
      !(keyboard && open && overlay.parentElement?.id === BOARD_INSPECTOR_ID)
    ) {
      return false;
    }
    if (open) {
      close();
    } else {
      focusTabOnOpen.current = keyboard;
      setOpen(true);
    }
    return true;
  };

  const focusOnOpen = useCallback(
    (container?: HTMLElement) => {
      if (cardOpen) return;
      const target = focusTabOnOpen.current ? tabRef.current : container;
      focusTabOnOpen.current = false;
      target?.focus();
    },
    [cardOpen],
  );

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.code !== "BracketRight" ||
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        isEditableTarget(event.target) ||
        !toggle(true)
      ) {
        return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const inspector = enabled
    ? {
        ...panels,
        open: open && !closeForCard,
        dragging,
        cardOpen,
        triggerRef,
        tabRef,
        focusOnOpen,
        close,
        showCard,
        toggle,
      }
    : null;

  return (
    <DragContext.Provider value={enabled ? setDragging : undefined}>
      <InspectorContext.Provider value={inspector}>
        {children}
      </InspectorContext.Provider>
    </DragContext.Provider>
  );
}
