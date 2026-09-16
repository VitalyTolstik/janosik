import type {
  AdminAuditRowDto,
  AdminAuthResponseDto,
  AdminBoardCommandRequest,
  AdminBoardRowDto,
  AdminCardRowDto,
  AdminCommandRowDto,
  AdminCommentRowDto,
  AdminCreateBoardRequest,
  AdminCreateMasterRequest,
  AdminCreateMasterResponse,
  AdminCreateUserRequest,
  AdminCreateUserResponse,
  AdminMasterRowDto,
  AdminSessionRowDto,
  AdminTokenRowDto,
  AdminMetricsDto,
  AdminPage,
  AdminUpdateMasterRequest,
  AdminUpdateUserRequest,
  AdminUserDto,
  AdminUserRowDto,
  BoardAggregate,
  CommandResponse,
} from "@janosik/shared";
import { ApiError, apiBaseUrl } from "@/api/client";

/**
 * Master-account HTTP client (TASK-36).
 *
 * Deliberately its own instance with its own in-memory token and its own
 * single-flight refresh: the user session and the admin session never share
 * a token, a promise or a failure callback. The refresh token rides the
 * `admin_refresh_token` cookie, which the browser only sends to
 * `/api/v1/admin/auth` — user routes cannot see it and vice versa.
 *
 * A dead admin session reports through `onAuthLost`, which the admin auth
 * provider turns into the master login screen.
 */

export interface AdminListParams {
  search?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

interface RequestInitLike {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

export class AdminApiClient {
  private accessToken: string | null = null;
  private refreshPromise: Promise<AdminAuthResponseDto | null> | null = null;
  onAuthLost: (() => void) | null = null;

  constructor(
    private readonly options: {
      baseUrl?: string;
      fetchImpl?: typeof fetch;
    } = {},
  ) {}

  getAccessToken(): string | null {
    return this.accessToken;
  }

  clearAccessToken(): void {
    this.accessToken = null;
  }

  async login(email: string, password: string): Promise<AdminAuthResponseDto> {
    const response = await this.request<AdminAuthResponseDto>(
      "/admin/auth/login",
      { method: "POST", body: { email, password }, auth: false },
    );
    this.accessToken = response.accessToken;
    return response;
  }

  async logout(): Promise<void> {
    try {
      await this.request<{ status: "ok" }>("/admin/auth/logout", {
        method: "POST",
        body: {},
        auth: false,
      });
    } finally {
      this.accessToken = null;
    }
  }

  me(): Promise<AdminUserDto> {
    return this.request<AdminUserDto>("/admin/auth/me");
  }

  refreshSession(): Promise<AdminAuthResponseDto | null> {
    if (this.refreshPromise === null) {
      this.refreshPromise = this.runRefresh().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  private async runRefresh(): Promise<AdminAuthResponseDto | null> {
    try {
      const response = await this.request<AdminAuthResponseDto>(
        "/admin/auth/refresh",
        { method: "POST", body: {}, auth: false },
      );
      this.accessToken = response.accessToken;
      return response;
    } catch {
      this.accessToken = null;
      return null;
    }
  }

  metrics(): Promise<AdminMetricsDto> {
    return this.request<AdminMetricsDto>("/admin/metrics");
  }

  listMasters(): Promise<AdminPage<AdminMasterRowDto>> {
    return this.request<AdminPage<AdminMasterRowDto>>("/admin/admins");
  }

  createMaster(
    body: AdminCreateMasterRequest,
  ): Promise<AdminCreateMasterResponse> {
    return this.request<AdminCreateMasterResponse>("/admin/admins", {
      method: "POST",
      body,
    });
  }

  updateMaster(
    masterId: string,
    body: AdminUpdateMasterRequest,
  ): Promise<AdminMasterRowDto> {
    return this.request<AdminMasterRowDto>(`/admin/admins/${masterId}`, {
      method: "PATCH",
      body,
    });
  }

  resetMasterPassword(masterId: string): Promise<AdminCreateMasterResponse> {
    return this.request<AdminCreateMasterResponse>(
      `/admin/admins/${masterId}/password/reset`,
      { method: "POST" },
    );
  }

  revokeMasterSessions(masterId: string): Promise<{ revoked: number }> {
    return this.request<{ revoked: number }>(
      `/admin/admins/${masterId}/sessions/revoke`,
      { method: "POST" },
    );
  }

  listUsers(params: AdminListParams = {}): Promise<AdminPage<AdminUserRowDto>> {
    return this.request<AdminPage<AdminUserRowDto>>(
      `/admin/users${this.query(params)}`,
    );
  }

  createUser(body: AdminCreateUserRequest): Promise<AdminCreateUserResponse> {
    return this.request<AdminCreateUserResponse>("/admin/users", {
      method: "POST",
      body,
    });
  }

  updateUser(
    userId: string,
    body: AdminUpdateUserRequest,
  ): Promise<AdminUserRowDto> {
    return this.request<AdminUserRowDto>(`/admin/users/${userId}`, {
      method: "PATCH",
      body,
    });
  }

  revokeUserSessions(userId: string): Promise<{ revoked: number }> {
    return this.request<{ revoked: number }>(
      `/admin/users/${userId}/sessions/revoke`,
      { method: "POST" },
    );
  }

  revokeUserTokens(userId: string): Promise<{ revoked: number }> {
    return this.request<{ revoked: number }>(
      `/admin/users/${userId}/tokens/revoke`,
      { method: "POST" },
    );
  }

  listBoards(
    params: AdminListParams = {},
  ): Promise<AdminPage<AdminBoardRowDto>> {
    return this.request<AdminPage<AdminBoardRowDto>>(
      `/admin/boards${this.query(params)}`,
    );
  }

  createBoard(body: AdminCreateBoardRequest): Promise<AdminBoardRowDto> {
    return this.request<AdminBoardRowDto>("/admin/boards", {
      method: "POST",
      body,
    });
  }

  /** Aggregate of one board for the content editor (same shape as the UI). */
  getBoardContent(boardId: string): Promise<BoardAggregate> {
    return this.request<BoardAggregate>(`/admin/boards/${boardId}/content`);
  }

  /** Apply a board content command as the owner, through the command log. */
  sendBoardCommand(
    boardId: string,
    request: AdminBoardCommandRequest,
  ): Promise<CommandResponse> {
    return this.request<CommandResponse>(`/admin/boards/${boardId}/commands`, {
      method: "POST",
      body: request,
    });
  }

  archiveBoard(boardId: string): Promise<AdminBoardRowDto> {
    return this.request<AdminBoardRowDto>(`/admin/boards/${boardId}/archive`, {
      method: "POST",
    });
  }

  unarchiveBoard(boardId: string): Promise<AdminBoardRowDto> {
    return this.request<AdminBoardRowDto>(
      `/admin/boards/${boardId}/unarchive`,
      { method: "POST" },
    );
  }

  deleteBoard(boardId: string): Promise<{ status: "ok" }> {
    return this.request<{ status: "ok" }>(`/admin/boards/${boardId}`, {
      method: "DELETE",
    });
  }

  listCards(params: AdminListParams = {}): Promise<AdminPage<AdminCardRowDto>> {
    return this.request<AdminPage<AdminCardRowDto>>(
      `/admin/cards${this.query(params)}`,
    );
  }

  archiveCard(cardId: string): Promise<{ status: "ok" }> {
    return this.request<{ status: "ok" }>(`/admin/cards/${cardId}/archive`, {
      method: "POST",
    });
  }

  unarchiveCard(cardId: string): Promise<{ status: "ok" }> {
    return this.request<{ status: "ok" }>(`/admin/cards/${cardId}/unarchive`, {
      method: "POST",
    });
  }

  deleteCard(cardId: string): Promise<{ status: "ok" }> {
    return this.request<{ status: "ok" }>(`/admin/cards/${cardId}`, {
      method: "DELETE",
    });
  }

  listSessions(
    params: AdminListParams = {},
  ): Promise<AdminPage<AdminSessionRowDto>> {
    return this.request<AdminPage<AdminSessionRowDto>>(
      `/admin/sessions${this.query(params)}`,
    );
  }

  revokeSession(sessionId: string): Promise<{ revoked: number }> {
    return this.request<{ revoked: number }>(
      `/admin/sessions/${sessionId}/revoke`,
      { method: "POST" },
    );
  }

  listTokens(
    params: AdminListParams = {},
  ): Promise<AdminPage<AdminTokenRowDto>> {
    return this.request<AdminPage<AdminTokenRowDto>>(
      `/admin/tokens${this.query(params)}`,
    );
  }

  revokeToken(tokenId: string): Promise<{ revoked: number }> {
    return this.request<{ revoked: number }>(
      `/admin/tokens/${tokenId}/revoke`,
      {
        method: "POST",
      },
    );
  }

  listComments(
    params: AdminListParams = {},
  ): Promise<AdminPage<AdminCommentRowDto>> {
    return this.request<AdminPage<AdminCommentRowDto>>(
      `/admin/comments${this.query(params)}`,
    );
  }

  deleteComment(commentId: string): Promise<{ status: "ok" }> {
    return this.request<{ status: "ok" }>(`/admin/comments/${commentId}`, {
      method: "DELETE",
    });
  }

  listCommands(
    params: AdminListParams = {},
  ): Promise<AdminPage<AdminCommandRowDto>> {
    return this.request<AdminPage<AdminCommandRowDto>>(
      `/admin/commands${this.query(params)}`,
    );
  }

  listAudit(
    params: AdminListParams = {},
  ): Promise<AdminPage<AdminAuditRowDto>> {
    return this.request<AdminPage<AdminAuditRowDto>>(
      `/admin/audit${this.query(params)}`,
    );
  }

  private query(params: AdminListParams): string {
    const search = new URLSearchParams();
    if (params.search) search.set("search", params.search);
    if (params.status && params.status !== "all") {
      search.set("status", params.status);
    }
    if (params.limit !== undefined) search.set("limit", String(params.limit));
    if (params.offset !== undefined)
      search.set("offset", String(params.offset));
    const value = search.toString();
    return value === "" ? "" : `?${value}`;
  }

  private async request<T>(
    path: string,
    init: RequestInitLike = {},
  ): Promise<T> {
    try {
      return await this.attempt<T>(path, init);
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 401 &&
        init.auth !== false
      ) {
        const restored = await this.refreshSession();
        if (restored !== null) return this.attempt<T>(path, init);
        this.accessToken = null;
        this.onAuthLost?.();
      }
      throw error;
    }
  }

  private async attempt<T>(path: string, init: RequestInitLike): Promise<T> {
    const base = this.options.baseUrl ?? apiBaseUrl();
    const headers: Record<string, string> = {};
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    if (init.auth !== false && this.accessToken !== null) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }

    const fetchImpl = this.options.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method: init.method ?? "GET",
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        credentials: "include",
      });
    } catch {
      throw new ApiError(0, null);
    }

    const text = await response.text();
    let parsed: unknown = undefined;
    if (text !== "") {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        throw new ApiError(response.status, null, "Invalid JSON from the API");
      }
    }
    if (!response.ok) throw new ApiError(response.status, parsed);
    return parsed as T;
  }
}

/** The admin-wide client, isolated from the user `api` singleton. */
export const adminApi = new AdminApiClient();
