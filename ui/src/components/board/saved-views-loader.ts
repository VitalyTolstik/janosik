/**
 * Single dynamic import seam for the lazy saved-views menu. Keeping it in a
 * tiny module lets the local error-boundary test reject the load without
 * mocking the component module itself (Vitest reports a factory throw as a
 * test-run error, not a lazy rejection).
 */
export function loadSavedViewsMenu() {
  return import("@/components/board/SavedViewsMenu");
}
