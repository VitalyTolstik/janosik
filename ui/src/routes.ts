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
  /**
   * Support "view as" entry point (TASK-59, U-8): the only route that
   * accepts an `#impersonate=` token; it then lands on the home redirect.
   */
  impersonate: "/impersonate",
  /** Agents console (TASK-166.13) — sessions across the caller's boards. */
  agents: "/agents",
  /** Detail of one agent token and its sessions. */
  agentPattern: "/agents/:tokenId",
  agent: (tokenId: string) => `/agents/${encodeURIComponent(tokenId)}`,
  /** Master panel (TASK-36) — lazy-loaded, never linked from user UI. */
  admin: "/admin",
  adminPattern: "/admin/*",
  /** Content editor of one board inside the master panel (TASK-43). */
  adminBoardContent: (boardId: string) => `/admin/boards/${boardId}/content`,
  /** Detail page of one board in the master panel. */
  adminBoardDetail: (boardId: string) => `/admin/boards/${boardId}`,
  /** Workflow editor of one board, acting for its owner. */
  adminBoardWorkflow: (boardId: string) => `/admin/boards/${boardId}/workflow`,
  /**
   * Public read-only board share (TASK-58, §7.9) — outside the auth shell
   * entirely, opened by token without a login. `?embed=1` drops the chrome
   * for an iframe.
   */
  sharePattern: "/s/:token",
  share: (token: string) => `/s/${token}`,
} as const;
