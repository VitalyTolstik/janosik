/**
 * Single source of truth for every route in the app (the classic routes
 * singleton): pattern constants for `<Route path>` / `matchPath` and
 * builder functions for `navigate` / `<Link to>`. The coupling between a
 * pattern and its builder (same `:boardId` param) lives here and nowhere
 * else — components reference route abstractions, never raw path strings.
 */
export const routes = {
  /** Home — always redirects to the first board. */
  home: "/",
  /** Canonical board address. */
  boardPattern: "/board/:boardId",
  board: (boardId: string) => `/board/${boardId}`,
  /** Master panel (TASK-36) — lazy-loaded, never linked from user UI. */
  admin: "/admin",
  adminPattern: "/admin/*",
} as const;
