import type {
  AuthResponseDto,
  AuthUserDto,
  BoardAggregate,
  BoardEnvelope,
  BoardMemberDto,
  BoardSummary,
  CommandRequest,
  CommandResponse,
  InviteMemberRequest,
  UpdateMemberRequest,
} from "@janosik/shared";

/**
 * Typed API client for the NestJS backend (§7.4, TASK-29).
 *
 * - The access token lives in memory only; the refresh token rides the
 *   httpOnly cookie, so a page reload restores the session through
 *   `POST /auth/refresh` (single-flight: parallel 401s wait for one shared
 *   refresh and then retry their call exactly once).
 * - A dead session (rotation/reuse, expired cookie) clears the token and
 *   fires `onAuthLost`, which the auth provider turns into the login screen.
 * - Network failures are `ApiError` with `status: 0` (`offline`), so the
 *   sync layer can tell "no network, nothing saved" from a server refusal.
 *
 * Server mode is off in the unit-test environment unless a test opts in by
 * stubbing `VITE_API_URL`; production and dev builds always talk to the API
 * (relative `/api/v1`, proxied by nginx in production and by Vite in dev).
 */

/** Error thrown for any non-2xx answer, a transport failure, or bad JSON. */
export class ApiError extends Error {
  constructor(
    /** HTTP status, or `0` when the request never reached the server. */
    readonly status: number,
    /** Parsed error body (NestJS envelope, `{conflict, currentVersion}`, …). */
    readonly body: unknown,
    message?: string,
  ) {
    super(message ?? ApiError.describe(status, body));
    this.name = "ApiError";
  }

  /** True when the request failed before any HTTP answer (offline). */
  get offline(): boolean {
    return this.status === 0;
  }

  /** `409` conflict category, when the server named one. */
  get conflict(): "version" | "wip" | undefined {
    const body = this.body as { conflict?: unknown } | null;
    return body?.conflict === "version" || body?.conflict === "wip"
      ? body.conflict
      : undefined;
  }

  /** `400 {field}` — the exact command field the strict validator rejected. */
  get field(): string | undefined {
    const body = this.body as { field?: unknown } | null;
    return typeof body?.field === "string" ? body.field : undefined;
  }

  /** Human-readable server message, unwrapping the NestJS `message` array. */
  get messageText(): string {
    const body = this.body as { message?: unknown } | null;
    const message = body?.message;
    if (typeof message === "string") return message;
    if (Array.isArray(message) && typeof message[0] === "string") {
      return message[0];
    }
    return this.message;
  }

  private static describe(status: number, body: unknown): string {
    if (status === 0) return "Network request failed";
    const message = (body as { message?: unknown } | null)?.message;
    if (typeof message === "string") return `API ${status}: ${message}`;
    return `API request failed with status ${status}`;
  }
}

/** Injectable dependencies — tests pass a fake fetch, the app uses defaults. */
export interface ApiClientOptions {
  /** Absolute or relative API root; defaults to `apiBaseUrl()`. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface RequestInitLike {
  method?: string;
  body?: unknown;
  /** Attach the access token (and retry once after a refresh on 401). */
  auth?: boolean;
  /**
   * Let the browser finish this request even if the page unloads right
   * after it was sent (`fetch` keepalive). Used for board commands: a
   * reload/close is expected behaviour, and a command already accepted by
   * the queue must not die in flight.
   */
  keepalive?: boolean;
}

/** Is the app wired to a backend? (Off in unit tests unless stubbed.) */
export function isApiEnabled(): boolean {
  return (
    import.meta.env.VITE_API_URL !== undefined ||
    import.meta.env.MODE !== "test"
  );
}

/** API root for the current build (`/api/v1` unless explicitly overridden). */
export function apiBaseUrl(): string {
  return import.meta.env.VITE_API_URL ?? "/api/v1";
}

export class ApiClient {
  private accessToken: string | null = null;
  private refreshPromise: Promise<AuthResponseDto | null> | null = null;
  /** Called once when a session cannot be restored — the app shows login. */
  onAuthLost: (() => void) | null = null;

  constructor(private readonly options: ApiClientOptions = {}) {}

  getAccessToken(): string | null {
    return this.accessToken;
  }

  clearAccessToken(): void {
    this.accessToken = null;
  }

  /** `POST /auth/register` — creates the account and starts the session. */
  async register(
    email: string,
    password: string,
    displayName?: string,
  ): Promise<AuthResponseDto> {
    const response = await this.request<AuthResponseDto>("/auth/register", {
      method: "POST",
      body: { email, password, displayName },
      auth: false,
    });
    this.accessToken = response.accessToken;
    return response;
  }

  /** `POST /auth/login` — starts the session; the refresh cookie is set. */
  async login(email: string, password: string): Promise<AuthResponseDto> {
    const response = await this.request<AuthResponseDto>("/auth/login", {
      method: "POST",
      body: { email, password },
      auth: false,
    });
    this.accessToken = response.accessToken;
    return response;
  }

  /** `POST /auth/logout` — revokes the refresh session server-side. */
  async logout(): Promise<void> {
    try {
      await this.request<{ status: "ok" }>("/auth/logout", {
        method: "POST",
        body: {},
        auth: false,
      });
    } finally {
      this.accessToken = null;
    }
  }

  /** `GET /auth/me` — verifies the in-memory access token. */
  me(): Promise<AuthUserDto> {
    return this.request<AuthUserDto>("/auth/me");
  }

  /**
   * Restore the session from the refresh cookie via `POST /auth/refresh`.
   * Single-flight: every caller shares one in-flight refresh; a failure
   * clears the token and returns `null` (no `onAuthLost` here — a cold boot
   * asks precisely to learn whether a session exists, and the login screen
   * is the answer, not an error).
   */
  refreshSession(): Promise<AuthResponseDto | null> {
    if (this.refreshPromise === null) {
      this.refreshPromise = this.runRefresh().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  private async runRefresh(): Promise<AuthResponseDto | null> {
    try {
      const response = await this.request<AuthResponseDto>("/auth/refresh", {
        method: "POST",
        body: {},
        auth: false,
      });
      this.accessToken = response.accessToken;
      return response;
    } catch {
      this.accessToken = null;
      return null;
    }
  }

  listBoards(): Promise<BoardSummary[]> {
    return this.request<BoardSummary[]>("/boards");
  }

  createBoard(title: string): Promise<BoardAggregate> {
    return this.request<BoardAggregate>("/boards", {
      method: "POST",
      body: { title },
    });
  }

  getBoard(boardId: string): Promise<BoardAggregate> {
    return this.request<BoardAggregate>(`/boards/${boardId}`);
  }

  deleteBoard(boardId: string): Promise<{ status: "ok" }> {
    return this.request<{ status: "ok" }>(`/boards/${boardId}`, {
      method: "DELETE",
    });
  }

  importBoards(envelope: BoardEnvelope): Promise<BoardAggregate[]> {
    return this.request<BoardAggregate[]>("/boards/import", {
      method: "POST",
      body: envelope,
    });
  }

  exportBoard(boardId: string): Promise<BoardEnvelope> {
    return this.request<BoardEnvelope>(`/boards/${boardId}/export`);
  }

  sendCommand(
    boardId: string,
    request: CommandRequest,
  ): Promise<CommandResponse> {
    return this.request<CommandResponse>(`/boards/${boardId}/commands`, {
      method: "POST",
      body: request,
      // Survives a reload in the middle of the request (see RequestInitLike).
      keepalive: true,
    });
  }

  listMembers(boardId: string): Promise<BoardMemberDto[]> {
    return this.request<BoardMemberDto[]>(`/boards/${boardId}/members`);
  }

  inviteMember(
    boardId: string,
    request: InviteMemberRequest,
  ): Promise<BoardMemberDto> {
    return this.request<BoardMemberDto>(`/boards/${boardId}/members`, {
      method: "POST",
      body: request,
    });
  }

  updateMember(
    boardId: string,
    userId: string,
    request: UpdateMemberRequest,
  ): Promise<BoardMemberDto> {
    return this.request<BoardMemberDto>(
      `/boards/${boardId}/members/${userId}`,
      { method: "PATCH", body: request },
    );
  }

  removeMember(boardId: string, userId: string): Promise<{ status: "ok" }> {
    return this.request<{ status: "ok" }>(
      `/boards/${boardId}/members/${userId}`,
      { method: "DELETE" },
    );
  }

  /** One HTTP round-trip with token, 401-refresh-retry and JSON handling. */
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
        keepalive: init.keepalive === true,
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

/**
 * The app-wide client. Components never construct their own: one instance
 * owns the access token and the shared refresh promise.
 */
export const api = new ApiClient();
