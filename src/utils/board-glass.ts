/**
 * Preset extremes for the column glass effect (TASK-8): the UI is a pair
 * of checkboxes (on/off), so values only ever take these two stops; older
 * slider values from previous versions are normalized to the nearest
 * preset on load.
 */
export const GLASS_PRESETS = {
  transparency: { off: 0, on: 100 },
  blur: { off: 0, on: 5 },
} as const;
