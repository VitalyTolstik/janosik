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
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return BOARD_ICON_COLORS[Math.abs(hash) % BOARD_ICON_COLORS.length];
}
