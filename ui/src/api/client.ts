import type {
  ActivityFeedPage,
  AnnouncementDto,
  AttachmentDto,
  AuthConfigResponse,
  AuthOAuthProvidersResponse,
  AuthResponseDto,
  AuthUserDto,
  BoardAggregate,
  BoardEnvelope,
  BoardInvitationDto,
  BoardMemberDto,
  BoardShareDto,
  BoardSummary,
  CommandRequest,
  CommandResponse,
  CommentDto,
  CommentPage,
  CreateShareRequest,
  CreateUserTokenRequest,
  CreateUserTokenResponse,
  InviteMemberRequest,
  UpdateMemberRequest,
  UpdateProfileRequest,
  UpdateShareRequest,
  UserTokenDto,
} from "@janosik/shared";
import { createId } from "@/utils/id";

/**
 * Typed API client for the NestJS backend (§7.4, TASK-29).
 *
 * - The access token lives in memory only; the refresh token rides the
 *   httpOnly cookie, so a page reload restores the session through
 *   `POST /auth/refresh` (single-flight: parallel 401s wait for one shared
 *   refresh and then retry their call exactly once, and the rotation is
 *   serialized across tabs through the Web Locks API — two tabs rotating
 *   the same cookie concurrently present an already-revoked token to the
 *   server, whose reuse detection then revokes every session of the user).
 * - A dead session (rotation/reuse, expired cookie) clears the token and
 *   fires `onAuthLost`, which the auth provider turns into the login screen.
 * - Network failures are `ApiError` with `status: 0` (`offline`), so the
 *   sync layer can tell "no network, nothing saved" from a server refusal.
 *
 * Server mode is off in the unit-test environment unless a test opts in by
 * stubbing `VITE_API_URL`; production and dev builds always talk to the API
 * (relative `/api/v1`, proxied by nginx in production and by Vite in dev).
 */

/**
 * Browser keepalive bodies cap out around 64 KB; stay well under it so a
 * large command is sent without `keepalive` instead of being rejected
 * synchronously (TASK-86).
 */
const KEEPALIVE_MAX_BYTES = 32 * 1024;

/** Error thrown for any non-2xx answer, a transport failure, or bad JSON. */
export class ApiError extends Error {
  constructor(
    /** HTTP status, or `0` when the request never reached the server. */
    readonly status: number,
    /** Parsed error body (NestJS envelope, `{conflict, currentVersion}`, …). */
    readonly body: unknown,
    message?: string,
    /**
     * The request never left the client (a synchronous construction error,
     * e.g. a keepalive body over the browser's size cap) — distinct from a
     * transport failure, so the sync layer does not mislabel it "offline"
     * (TASK-86).
     */
    readonly clientSide = false,
  ) {
    super(message ?? ApiError.describe(status, body));
    this.name = "ApiError";
  }

  /** True when the request failed before any HTTP answer (offline). */
  get offline(): boolean {
    return this.status === 0 && !this.clientSide;
  }

  /** `409` conflict category, when the server named one. */
  get conflict(): "version" | "wip" | "id" | undefined {
    const body = this.body as { conflict?: unknown } | null;
    return body?.conflict === "version" ||
      body?.conflict === "wip" ||
      body?.conflict === "id"
      ? body.conflict
      : undefined;
  }

  /**
   * Machine-readable error code, when the server named one
   * (`login_backoff`, `board_write_timeout`, …).
   */
  get code(): string | undefined {
    const body = this.body as { code?: unknown } | null;
    return typeof body?.code === "string" ? body.code : undefined;
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
  /**
   * Multipart body (TASK-47 uploads) — sent as-is; the browser sets the
   * `Content-Type` boundary, so no header is added here.
   */
  form?: FormData;
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

/** Web Locks name: one refresh at a time per browser profile. */
export const REFRESH_LOCK = "janosik:auth-refresh";

/**
 * Run `task` under a cross-tab lock when the browser has the Web Locks API.
 *
 * `refreshPromise` only dedupes within one tab, but the refresh cookie is
 * shared by every tab of the profile: two tabs refreshing at the same time
 * both present the same token, one rotation wins, and the loser is treated
 * as token theft — the server revokes **all** sessions of the user. In live
 * testing (2026-09-17) that is exactly what happened: two refresh calls
 * presenting the same token within the same instant, then "all sessions
 * revoked". The tab that waited refreshes afterwards with the cookie the
 * winner just rotated in, which is a normal rotation. Browsers without the
 * API keep the old single-tab behaviour (the in-tab promise still
 * serializes).
 */
async function withRefreshLock<T>(task: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (locks === undefined) return task();
  return locks.request(REFRESH_LOCK, task);
}

export class ApiClient {
  private accessToken: string | null = null;
  private refreshPromise: Promise<AuthResponseDto | null> | null = null;
  /**
   * Bumped whenever a session is established or dropped (login/register/
   * logout/clear). A refresh that started before the bump is stale and must
   * not write its outcome into the client: a slow boot refresh answering
   * 401 just after a successful login would otherwise wipe the fresh token
   * and bounce the user back to the login screen.
   */
  private sessionEpoch = 0;
  /**
   * True while a master "view as" session is active (TASK-85). A refresh
   * would send the *master's* httpOnly cookie and silently upgrade the tab
   * to the master session, so refresh is refused and a 401 ends the view-as
   * session instead.
   */
  private impersonating = false;
  /** Called once when a session cannot be restored — the app shows login. */
  onAuthLost: (() => void) | null = null;

  constructor(private readonly options: ApiClientOptions = {}) {}

  getAccessToken(): string | null {
    return this.accessToken;
  }

  /** Mark this client as a view-as session (TASK-85). */
  setImpersonating(value: boolean): void {
    this.impersonating = value;
  }

  isImpersonating(): boolean {
    return this.impersonating;
  }

  clearAccessToken(): void {
    this.accessToken = null;
    this.sessionEpoch += 1;
  }

  /** Adopts an externally-minted access token (TASK-59 impersonation). */
  setAccessToken(token: string): void {
    this.accessToken = token;
    this.sessionEpoch += 1;
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
    this.sessionEpoch += 1;
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
    this.sessionEpoch += 1;
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
      this.clearAccessToken();
    }
  }

  /** `GET /auth/me` — verifies the in-memory access token. */
  me(): Promise<AuthUserDto> {
    return this.request<AuthUserDto>("/auth/me");
  }

  /** `GET /announcements/active` — banners the signed-in user should see. */
  activeAnnouncements(): Promise<AnnouncementDto[]> {
    return this.request<AnnouncementDto[]>("/announcements/active");
  }

  /**
   * `GET /auth/oauth/providers` (TASK-54) — which external login buttons the
   * sign-in screen should render. A failure means "no buttons", never an
   * error state: password login must stay fully functional without it.
   */
  async listOAuthProviders(): Promise<AuthOAuthProvidersResponse> {
    try {
      const body = await this.request<AuthOAuthProvidersResponse>(
        "/auth/oauth/providers",
        { auth: false },
      );
      // Defensive against a newer/older backend that answers differently.
      return {
        providers: Array.isArray(body?.providers) ? body.providers : [],
      };
    } catch {
      return { providers: [] };
    }
  }

  /** Full-page navigation target that starts the OAuth round trip. */
  oauthStartUrl(provider: string): string {
    return `${apiBaseUrl()}/auth/oauth/${provider}/start`;
  }

  /**
   * `GET /auth/config` (TASK-38a) — public runtime flags for the sign-in
   * screen. A failure keeps registration visible: password/registration
   * login must never depend on this call, and the server still enforces the
   * flag, so a false positive only shows a form that would then 403.
   */
  async authConfig(): Promise<AuthConfigResponse> {
    try {
      const body = await this.request<AuthConfigResponse>("/auth/config", {
        auth: false,
      });
      return {
        allowRegistration: body?.allowRegistration !== false,
        allowPublicShares: body?.allowPublicShares !== false,
      };
    } catch {
      return { allowRegistration: true, allowPublicShares: true };
    }
  }

  /** `PATCH /users/me` — display name / avatar color (TASK-36.1). */
  updateProfile(patch: UpdateProfileRequest): Promise<AuthUserDto> {
    return this.request<AuthUserDto>("/users/me", {
      method: "PATCH",
      body: patch,
    });
  }

  /**
   * `POST /auth/password` — verifies the current password and revokes every
   * other refresh session (TASK-36.1). Lives under `/auth` so the refresh
   * cookie is actually sent and identifies the caller's session.
   */
  changePassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<{ status: "ok" }> {
    return this.request<{ status: "ok" }>("/auth/password", {
      method: "POST",
      body: { currentPassword, newPassword },
    });
  }

  /**
   * `POST /auth/verify-email` (TASK-53) — activates the account with the
   * 6-digit code from the signup email; the response carries the fresh
   * profile (the session itself stays valid).
   */
  verifyEmail(code: string): Promise<{ user: AuthUserDto }> {
    return this.request<{ user: AuthUserDto }>("/auth/verify-email", {
      method: "POST",
      body: { code },
    });
  }

  /**
   * `POST /auth/verify-email/resend` (TASK-53) — a fresh code goes to the
   * registered address.
   */
  resendEmailVerification(): Promise<{ expiresAt: number; queued: boolean }> {
    return this.request<{ expiresAt: number; queued: boolean }>(
      "/auth/verify-email/resend",
      {
        method: "POST",
        body: {},
      },
    );
  }

  /**
   * `POST /auth/email/change/request` (TASK-51) — step 1 of the double
   * opt-in: verifies the current password and emails a 6-digit code to the
   * new address. The code itself never travels through this client.
   */
  requestEmailChange(
    newEmail: string,
    currentPassword: string,
  ): Promise<{ expiresAt: number; queued: boolean }> {
    return this.request<{ expiresAt: number; queued: boolean }>(
      "/auth/email/change/request",
      {
        method: "POST",
        body: { newEmail, currentPassword },
      },
    );
  }

  /**
   * `POST /auth/email/change/confirm` (TASK-51) — step 2: the code swaps
   * the address and the response carries a fresh session (same contract as
   * login), so the stored access token is replaced here.
   */
  async confirmEmailChange(code: string): Promise<AuthResponseDto> {
    const response = await this.request<AuthResponseDto>(
      "/auth/email/change/confirm",
      {
        method: "POST",
        body: { code },
      },
    );
    this.accessToken = response.accessToken;
    this.sessionEpoch += 1;
    return response;
  }

  /** `GET /users/me/tokens` — personal API tokens (TASK-36.1). */
  listTokens(): Promise<UserTokenDto[]> {
    return this.request<UserTokenDto[]>("/users/me/tokens");
  }

  /** `POST /users/me/tokens` — plaintext returned exactly once. */
  createToken(body: CreateUserTokenRequest): Promise<CreateUserTokenResponse> {
    return this.request<CreateUserTokenResponse>("/users/me/tokens", {
      method: "POST",
      body,
    });
  }

  /** `DELETE /users/me/tokens/:id` — revoke (idempotent). */
  revokeToken(id: string): Promise<{ status: "ok" }> {
    return this.request<{ status: "ok" }>(
      `/users/me/tokens/${encodeURIComponent(id)}`,
      { method: "DELETE", body: {} },
    );
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
    // A view-as tab must never rotate into the master session (TASK-85).
    if (this.impersonating) return null;
    const epoch = this.sessionEpoch;
    try {
      const response = await withRefreshLock(() =>
        this.request<AuthResponseDto>("/auth/refresh", {
          method: "POST",
          body: {},
          auth: false,
        }),
      );
      // A login/register that landed while this refresh was in flight owns
      // the session now; the refreshed user may even differ (account switch).
      if (epoch !== this.sessionEpoch) return null;
      this.accessToken = response.accessToken;
      return response;
    } catch {
      if (epoch === this.sessionEpoch) this.accessToken = null;
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

  /**
   * The aggregate plus the command `seq` it reflects (`X-Board-Seq`, TASK-30)
   * — the baseline the realtime stream resumes from. The body stays the
   * plain aggregate, so nothing about the board shape changes.
   */
  async getBoardSnapshot(
    boardId: string,
  ): Promise<{ board: BoardAggregate; seq: number }> {
    const { data, headers } = await this.requestWithHeaders<BoardAggregate>(
      `/boards/${boardId}`,
    );
    const seq = Number(headers.get("X-Board-Seq") ?? "0");
    return { board: data, seq: Number.isFinite(seq) && seq > 0 ? seq : 0 };
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

  // ------------------------------------------- public shares (TASK-58)

  /** The board's public links (ADMIN) — for the "Share" dialog. */
  listShares(boardId: string): Promise<BoardShareDto[]> {
    return this.request<BoardShareDto[]>(`/boards/${boardId}/shares`);
  }

  createShare(
    boardId: string,
    request: CreateShareRequest,
  ): Promise<BoardShareDto> {
    return this.request<BoardShareDto>(`/boards/${boardId}/shares`, {
      method: "POST",
      body: request,
    });
  }

  /** Re-freeze a snapshot share with the board's current content. */
  refreshShare(boardId: string, shareId: string): Promise<BoardShareDto> {
    return this.request<BoardShareDto>(
      `/boards/${boardId}/shares/${shareId}/refresh`,
      { method: "POST" },
    );
  }

  updateShare(
    boardId: string,
    shareId: string,
    request: UpdateShareRequest,
  ): Promise<BoardShareDto> {
    return this.request<BoardShareDto>(`/boards/${boardId}/shares/${shareId}`, {
      method: "PATCH",
      body: request,
    });
  }

  revokeShare(boardId: string, shareId: string): Promise<BoardShareDto> {
    return this.request<BoardShareDto>(`/boards/${boardId}/shares/${shareId}`, {
      method: "DELETE",
    });
  }

  sendCommand(
    boardId: string,
    request: CommandRequest,
  ): Promise<CommandResponse> {
    // `keepalive` survives a reload mid-flight, but the browser caps a
    // keepalive body at ~64 KB (TASK-86): a big RESTORE_* command must be
    // sent without it rather than rejected by a synchronous TypeError.
    const bytes = new TextEncoder().encode(JSON.stringify(request)).length;
    return this.request<CommandResponse>(`/boards/${boardId}/commands`, {
      method: "POST",
      body: request,
      keepalive: bytes <= KEEPALIVE_MAX_BYTES,
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

  listInvitations(): Promise<BoardInvitationDto[]> {
    return this.request<BoardInvitationDto[]>("/invitations");
  }

  acceptInvitation(invitationId: string): Promise<{ status: "ok" }> {
    return this.request<{ status: "ok" }>(
      `/invitations/${invitationId}/accept`,
      { method: "POST" },
    );
  }

  declineInvitation(invitationId: string): Promise<{ status: "ok" }> {
    return this.request<{ status: "ok" }>(
      `/invitations/${invitationId}/decline`,
      { method: "POST" },
    );
  }

  /** Newest-first page of a card's comments (TASK-28 REST, TASK-37 UI). */
  listComments(
    cardId: string,
    cursor?: string,
    limit?: number,
  ): Promise<CommentPage> {
    return this.request<CommentPage>(
      `/cards/${encodeURIComponent(cardId)}/comments${pageQuery(cursor, limit)}`,
    );
  }

  /**
   * Post a comment. `commandId` is the idempotency key (TASK-99) — a retry
   * with the same key returns the first comment; a fresh one is generated
   * per call so an automatic retry never doubles the comment.
   */
  createComment(
    cardId: string,
    text: string,
    commandId: string = createId(),
  ): Promise<CommentDto> {
    return this.request<CommentDto>(
      `/cards/${encodeURIComponent(cardId)}/comments`,
      { method: "POST", body: { text, commandId } },
    );
  }

  /** Soft-deletes the caller's own comment; the server answers 403 otherwise. */
  deleteComment(commentId: string): Promise<{ status: "ok" }> {
    return this.request<{ status: "ok" }>(
      `/comments/${encodeURIComponent(commentId)}`,
      { method: "DELETE" },
    );
  }

  /** Live attachments of one card, newest-first (TASK-47). */
  listAttachments(cardId: string): Promise<AttachmentDto[]> {
    return this.request<AttachmentDto[]>(
      `/cards/${encodeURIComponent(cardId)}/attachments`,
    );
  }

  /**
   * Upload one file (multipart); the server answers 400/413 on limits.
   * `inline` marks body-embedded media (pasted into a description/comment):
   * hidden from the attachment list, no card badge count.
   */
  uploadAttachment(
    cardId: string,
    file: File,
    opts: { inline?: boolean } = {},
  ): Promise<AttachmentDto> {
    const form = new FormData();
    form.append("file", file, file.name);
    return this.request<AttachmentDto>(
      `/cards/${encodeURIComponent(cardId)}/attachments${opts.inline ? "?inline=1" : ""}`,
      { method: "POST", form },
    );
  }

  /** Remove an attachment (uploader or board ADMIN). */
  deleteAttachment(attachmentId: string): Promise<{ status: "ok" }> {
    return this.request<{ status: "ok" }>(
      `/attachments/${encodeURIComponent(attachmentId)}`,
      { method: "DELETE" },
    );
  }

  /**
   * Fetch an attachment blob (binary — skips the JSON parse) so the caller
   * can save it; the endpoint sends `Content-Disposition: attachment`.
   */
  async fetchAttachment(attachmentId: string): Promise<Blob> {
    const response = await this.requestRaw(
      `/attachments/${encodeURIComponent(attachmentId)}/content`,
    );
    return response.blob();
  }

  /**
   * Fetch a media derivative (TASK-70): the image thumbnail or the video
   * poster. Falls back to the full blob when the server has no derivative.
   */
  async fetchAttachmentDerivative(
    attachmentId: string,
    kind: "thumbnail" | "poster",
  ): Promise<Blob> {
    try {
      const response = await this.requestRaw(
        `/attachments/${encodeURIComponent(attachmentId)}/${kind}`,
      );
      return await response.blob();
    } catch {
      return this.fetchAttachment(attachmentId);
    }
  }

  /** Upload the profile avatar image (TASK-47). */
  uploadAvatar(file: File): Promise<AuthUserDto> {
    const form = new FormData();
    form.append("file", file, file.name);
    return this.request<AuthUserDto>("/users/me/avatar", {
      method: "PATCH",
      form,
    });
  }

  /**
   * Fetch a user's avatar image as a blob (404 when the user has none).
   * The endpoint is served with long-lived `immutable` caching, so callers
   * pass the stored name as `version` — a new upload produces a new URL and
   * the browser cache cannot return the previous image.
   */
  async fetchUserAvatar(userId: string, version?: string): Promise<Blob> {
    const base = `/users/${encodeURIComponent(userId)}/avatar`;
    const response = await this.requestRaw(
      version ? `${base}?v=${encodeURIComponent(version)}` : base,
    );
    return response.blob();
  }

  /** Newest-first history of one card (TASK-28 feed, diffs TASK-37). */
  cardActivity(
    cardId: string,
    cursor?: string,
    limit?: number,
  ): Promise<ActivityFeedPage> {
    return this.request<ActivityFeedPage>(
      `/cards/${encodeURIComponent(cardId)}/activity${pageQuery(cursor, limit)}`,
    );
  }

  /** One HTTP round-trip with token, 401-refresh-retry and JSON handling. */
  private async request<T>(
    path: string,
    init: RequestInitLike = {},
  ): Promise<T> {
    return (await this.requestWithHeaders<T>(path, init)).data;
  }

  /**
   * Binary variant of `request` (TASK-47 downloads): same token and
   * 401-refresh-retry, but the response body is handed over untouched
   * instead of being parsed as JSON.
   */
  private async requestRaw(path: string): Promise<Response> {
    const send = (): Promise<Response> => {
      const base = this.options.baseUrl ?? apiBaseUrl();
      const headers: Record<string, string> = {};
      if (this.accessToken !== null) {
        headers.Authorization = `Bearer ${this.accessToken}`;
      }
      return fetch(`${base}${path}`, { headers, credentials: "include" });
    };
    try {
      const response = await send();
      if (response.status === 401 && this.accessToken !== null) {
        if (this.impersonating) {
          this.onAuthLost?.();
          throw new ApiError(401, null);
        }
        const restored = await this.refreshSession();
        if (restored !== null || this.accessToken !== null) {
          return send();
        }
        this.onAuthLost?.();
      }
      if (!response.ok) throw new ApiError(response.status, null);
      return response;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(0, null);
    }
  }

  /** `request`, keeping the response headers for callers that need them. */
  private async requestWithHeaders<T>(
    path: string,
    init: RequestInitLike = {},
  ): Promise<{ data: T; headers: Headers }> {
    try {
      return await this.attempt<T>(path, init);
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 401 &&
        init.auth !== false
      ) {
        // TASK-85: a dead view-as token must not be refreshed against the
        // master cookie — hand it to the provider, which leaves view-as.
        if (this.impersonating) {
          this.onAuthLost?.();
          throw error;
        }
        const restored = await this.refreshSession();
        // `null` with a token present means the refresh was superseded by a
        // login/register (see `sessionEpoch`) — retry with that token.
        if (restored !== null || this.accessToken !== null) {
          return this.attempt<T>(path, init);
        }
        this.onAuthLost?.();
      }
      throw error;
    }
  }

  private async attempt<T>(
    path: string,
    init: RequestInitLike,
  ): Promise<{ data: T; headers: Headers }> {
    const base = this.options.baseUrl ?? apiBaseUrl();
    const headers: Record<string, string> = {};
    if (init.form === undefined && init.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (init.auth !== false && this.accessToken !== null) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }

    const fetchImpl = this.options.fetchImpl ?? fetch;
    // A synchronous throw here is a construction error (bad argument, e.g. a
    // keepalive body past the browser's ~64 KB cap); a rejection is a
    // transport failure. Keeping them apart stops the sync layer from
    // treating the former as "offline" (TASK-86).
    let pending: Promise<Response>;
    try {
      pending = fetchImpl(`${base}${path}`, {
        method: init.method ?? "GET",
        headers,
        body:
          init.form ??
          (init.body === undefined ? undefined : JSON.stringify(init.body)),
        credentials: "include",
        keepalive: init.keepalive === true,
      });
    } catch (error) {
      throw new ApiError(
        0,
        null,
        error instanceof Error ? error.message : "Request could not be sent",
        true,
      );
    }
    let response: Response;
    try {
      response = await pending;
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
    return { data: parsed as T, headers: response.headers };
  }
}

/**
 * The app-wide client. Components never construct their own: one instance
 * owns the access token and the shared refresh promise.
 */
export const api = new ApiClient();

/** Opaque cursor + bound query for the paginated endpoints. */
function pageQuery(cursor?: string, limit?: number): string {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  if (limit !== undefined) params.set("limit", String(limit));
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}
