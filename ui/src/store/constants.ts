/**
 * UI-side timing constants. Deliberately kept out of `@janosik/shared`:
 * they describe how this client persists to localStorage, not the domain
 * model or the command contract.
 */

/** Debounce before the board state is written to localStorage (ms). */
export const SAVE_DEBOUNCE_MS = 400;
