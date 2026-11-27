import { useEffect, useRef } from "react";

import { isEditableTarget, isShortcutHelpKey } from "@/utils/keyboard";
import { isOverlayOpen } from "@/utils/overlay";

/**
 * "?" opens the shortcut sheet directly (Jira/Notion/GitHub convention).
 * Shared by the standalone Help menu and the Board menu so both board and
 * non-board routes keep the shortcut without mounting two listeners.
 */
export function useShortcutsHotkey(openShortcuts: () => void) {
  const openRef = useRef(openShortcuts);
  useEffect(() => {
    openRef.current = openShortcuts;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        isEditableTarget(event.target) ||
        isOverlayOpen()
      )
        return;
      if (isShortcutHelpKey(event)) {
        event.preventDefault();
        openRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
