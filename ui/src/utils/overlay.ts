const OVERLAY_SELECTOR = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[data-slot="context-menu-content"]',
].join(", ");

/**
 * Find the topmost visible modal, menu, listbox or context menu.
 *
 * Tooltips are deliberately excluded: hovering a hint must not disable the
 * global keyboard shortcuts. Radix popovers render with `role="dialog"`, so
 * the filter facets and pickers are covered without matching every popper
 * wrapper (which would also catch tooltips).
 *
 * A surface that is animating out keeps its role for the exit duration but
 * already has `data-state="closed"`; it no longer owns the keyboard, so the
 * first Ctrl+Z or `?` after closing must work instead of being swallowed.
 * Inline results and submenu contents belong to their enclosing surface.
 * Portalled surfaces appear later in the DOM and own focus first.
 */
export function findOpenOverlay(): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR))
    .reverse()
    .find(
      (overlay) =>
        !overlay.closest(
          '[data-state="closed"], [hidden], [aria-hidden="true"], [inert]',
        ) && !overlay.parentElement?.closest(OVERLAY_SELECTOR),
    );
}

export function isOverlayOpen(): boolean {
  return findOpenOverlay() !== undefined;
}
