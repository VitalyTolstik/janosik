/**
 * Single source of truth for the localStorage keys the app owns.
 *
 * Both the theme preflight (inlined in `index.html`, which cannot import
 * this module because it runs before the bundle) and the runtime must agree
 * on these names — the inline script therefore duplicates the theme key as a
 * literal on purpose. Everything bundled imports the constants instead.
 */

/** Persisted board collection. */
export const BOARD_STORAGE_KEY = "janosik-boards";

/** Persisted theme preference: `"dark"` | `"light"`. */
export const THEME_STORAGE_KEY = "janosik-theme";
