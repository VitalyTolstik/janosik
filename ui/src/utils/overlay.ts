/**
 * True when a modal, menu, listbox or context menu owns the interaction
 * layer.
 *
 * Tooltips are deliberately excluded: hovering a hint must not disable the
 * global keyboard shortcuts. Radix popovers render with `role="dialog"`, so
 * the filter facets and pickers are covered without matching every popper
 * wrapper (which would also catch tooltips).
 */
export function isOverlayOpen(): boolean {
  return (
    document.querySelector(
      '[role="dialog"], [role="menu"], [role="listbox"], [data-slot="context-menu-content"]',
    ) !== null
  );
}
