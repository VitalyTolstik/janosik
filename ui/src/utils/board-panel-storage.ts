export const RIGHT_PANEL_MIN = 320;
export const RIGHT_PANEL_MAX = 480;
export const RIGHT_PANEL_DEFAULT = 360;
export const RIGHT_PANEL_WIDE_DEFAULT = 400;
export const INSPECTOR_TABS = ["people", "activity", "card"] as const;
export type InspectorTab = (typeof INSPECTOR_TABS)[number];

export type BoardPanelPrefs = {
  version: 1;
  right: { open: boolean; width: number; tab: InspectorTab };
  left: { open: boolean; width: number };
};

type StoredBoardPanelPrefs = Omit<BoardPanelPrefs, "right"> & {
  right: Omit<BoardPanelPrefs["right"], "width"> & { width?: number };
};

function clampWidth(width: number, min: number, max: number, fallback: number) {
  return Number.isFinite(width)
    ? Math.min(max, Math.max(min, Math.round(width)))
    : fallback;
}

export function clampRightWidth(width: number, fallback = RIGHT_PANEL_DEFAULT) {
  return clampWidth(width, RIGHT_PANEL_MIN, RIGHT_PANEL_MAX, fallback);
}

export function boardPanelKey(userId: string, boardId: string) {
  return `janosik-board-panels:v1:${userId}:${boardId}`;
}

// Keep a usable in-memory copy when storage is denied or full.
const sessionPrefs = new Map<string, BoardPanelPrefs>();

function readStoredValue(key: string) {
  const raw = localStorage.getItem(key);
  if (raw === null) return;
  try {
    return JSON.parse(raw) as
      | (Partial<Omit<BoardPanelPrefs, "version">> & { version?: unknown })
      | null;
  } catch {
    return;
  }
}

export function readBoardPanels(
  key: string,
): StoredBoardPanelPrefs | undefined {
  const session = sessionPrefs.get(key);
  if (session) return session;
  try {
    const prefs = readStoredValue(key);
    if (prefs?.version !== 1) return;
    const width = prefs.right?.width;
    return {
      version: 1,
      right: {
        open: prefs.right?.open === true,
        width:
          typeof width === "number" && Number.isFinite(width)
            ? clampRightWidth(width)
            : undefined,
        tab: INSPECTOR_TABS.find((tab) => tab === prefs.right?.tab) ?? "people",
      },
      left: {
        open: prefs.left?.open === true,
        width: clampWidth(prefs.left?.width ?? NaN, 240, 320, 280),
      },
    };
  } catch {
    return;
  }
}

export function writeBoardPanels(key: string, prefs: BoardPanelPrefs) {
  const next = {
    ...prefs,
    right: { ...prefs.right, width: clampRightWidth(prefs.right.width) },
  };
  try {
    const version = readStoredValue(key)?.version;
    if (typeof version === "number" && version > next.version) {
      sessionPrefs.set(key, next);
      return;
    }
    localStorage.setItem(key, JSON.stringify(next));
    sessionPrefs.delete(key);
  } catch {
    sessionPrefs.set(key, next);
  }
}
