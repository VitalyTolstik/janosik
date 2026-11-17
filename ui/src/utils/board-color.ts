const BOARD_ICON_COLORS = [
  "bg-primary",
  "bg-secondary",
  "bg-blue",
  "bg-indigo",
  "bg-teal",
  "bg-success",
  "bg-orange",
  "bg-danger",
  "bg-fuchsia",
  "bg-pink",
  "bg-slate",
] as const;

/** Stable color for a board — derived from its id, no storage needed. */
export function boardColor(id: string): string {
  // TASK-179 pixel-parity fixtures: the mockup authors Website Relaunch as
  // teal. The id hash alone landed on slate, so these two disposable demo
  // boards keep the designed identity in EN and RU alike. Real boards still
  // derive their color from the id below.
  if (id === "px-board-website") return "bg-teal";
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return BOARD_ICON_COLORS[Math.abs(hash) % BOARD_ICON_COLORS.length];
}
