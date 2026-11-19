const OVERLAY_SELECTOR = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[data-slot="context-menu-content"]',
].join(", ");

/**
 * True when a modal, menu, listbox or context menu owns the interaction
 * layer.
 *
 * Tooltips are deliberately excluded: hovering a hint must not disable the
 * global keyboard shortcuts. Radix popovers render with `role="dialog"`, so
 * the filter facets and pickers are covered without matching every popper
 * wrapper (which would also catch tooltips).
 *
 * A surface that is animating out keeps its role for the exit duration but
 * already has `data-state="closed"`; it no longer owns the keyboard, so the
 * first Ctrl+Z or `?` after closing must work instead of being swallowed.
 */
export function isOverlayOpen(): boolean {
  return [...document.querySelectorAll(OVERLAY_SELECTOR)].some(
    (overlay) => overlay.getAttribute("data-state") !== "closed",
  );
}
