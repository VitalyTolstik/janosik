import type {
  AdminAuditRowDto,
  AdminAuthResponseDto,
  AdminBoardCommandRequest,
  AdminBoardDetailDto,
  AdminBoardRowDto,
  AdminCardDetailDto,
  AdminCardRowDto,
  AdminCommandRowDto,
  AdminCommentRowDto,
  AdminCreateBoardRequest,
  AdminCreateMasterRequest,
  AdminCreateMasterResponse,
  AdminCreateUserRequest,
  AdminCreateUserResponse,
  AdminDemoStartRequest,
  AdminDemoStatusDto,
  AdminEmailSettingsDto,
  AdminEmailTestRequest,
  AdminEmailTestResponse,
  AdminOAuthProviderDto,
  AdminThrottleSettingsDto,
  AdminTrafficDto,
  AdminUpdateThrottleSettingsRequest,
  AdminUpdateOAuthProviderRequest,
  AdminEntity,
  AdminEntityRowMap,
  AdminGlobalSearchDto,
  AdminMasterRowDto,
  AdminSessionRowDto,
  AdminTokenRowDto,
  AdminMetricsDto,
  AdminShareRowDto,
  AdminPage,
  AdminAnnouncementDto,
  AdminBulkResultDto,
  AdminCreateAnnouncementRequest,
  AdminEmailTemplateDto,
  AdminFeatureFlagDto,
  AdminImpersonationDto,
  AdminObservabilityDto,
  AdminOpsSettingsDto,
  AdminPromoteUserResponse,
  AdminResendVerificationResponse,
  AdminResetUserPasswordResponse,
  AdminRetentionDto,
  AdminSecurityDto,
  AdminSendEmailRequest,
  AdminSendEmailResponse,
  AdminTotpSetupDto,
  AdminUpdateAnnouncementRequest,
  AdminUpdateFeatureFlagRequest,
  AdminUpdateOpsSettingsRequest,
  AdminUpdateSecurityRequest,
  AdminUserExportDto,
  AdminAddBoardMemberRequest,
  AdminUpdateBoardMemberRequest,
  AdminUpdateEmailSettingsRequest,
  AdminUpdateMasterRequest,
  AdminUpdateUserRequest,
  AdminUserDetailDto,
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
  /** Inclusive `createdAt` lower bound, unix ms (period tabs). */
  from?: number;
  /** Inclusive `createdAt` upper bound, unix ms. */
  to?: number;
  limit?: number;
  offset?: number;
}

interface RequestInitLike {
  method?: string;
  body?: unknown;
  auth?: boolean;
  /** Keep the request alive through a page unload (board commands). */
  keepalive?: boolean;
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

  async login(
    email: string,
    password: string,
    totpCode?: string,
  ): Promise<AdminAuthResponseDto> {
    const response = await this.request<AdminAuthResponseDto>(
      "/admin/auth/login",
      {
        method: "POST",
        body: { email, password, totpCode },
        auth: false,
      },
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

  /** Download an attachment blob for support analysis (admin guard). */
  async downloadAttachment(attachmentId: string): Promise<Blob> {
    const base = this.options.baseUrl ?? apiBaseUrl();
    const headers: Record<string, string> = {};
    if (this.accessToken !== null) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const response = await fetchImpl(
      `${base}/admin/attachments/${encodeURIComponent(attachmentId)}/download`,
      { headers, credentials: "include" },
    );
    if (!response.ok) throw new ApiError(response.status, null);
    return response.blob();
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

  // ------------------------------------------------- admin v2 (TASK-48)

  /** Generic listing over any of the `ADMIN_ENTITIES`. */
  listEntity<E extends AdminEntity>(
    entity: E,
    params: AdminListParams = {},
  ): Promise<AdminPage<AdminEntityRowMap[E]>> {
    return this.request<AdminPage<AdminEntityRowMap[E]>>(
      `/admin/entities/${entity}${this.query(params)}`,
    );
  }

  /** Cross-entity top matches for the panel omnibox. */
  globalSearch(query: string): Promise<AdminGlobalSearchDto> {
    const params = new URLSearchParams({ q: query });
    return this.request<AdminGlobalSearchDto>(
      `/admin/search?${params.toString()}`,
    );
  }

  userDetail(userId: string): Promise<AdminUserDetailDto> {
    return this.request<AdminUserDetailDto>(
      `/admin/users/${encodeURIComponent(userId)}/detail`,
    );
  }

  cardDetail(cardId: string): Promise<AdminCardDetailDto> {
    return this.request<AdminCardDetailDto>(
      `/admin/cards/${encodeURIComponent(cardId)}/detail`,
    );
  }

  boardDetail(boardId: string): Promise<AdminBoardDetailDto> {
    return this.request<AdminBoardDetailDto>(
      `/admin/boards/${encodeURIComponent(boardId)}/meta`,
    );
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
      keepalive: true,
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

  // ------------------------------------------- email settings (TASK-52)

  getEmailSettings(): Promise<AdminEmailSettingsDto> {
    return this.request<AdminEmailSettingsDto>("/admin/email-settings");
  }

  updateEmailSettings(
    body: AdminUpdateEmailSettingsRequest,
  ): Promise<AdminEmailSettingsDto> {
    return this.request<AdminEmailSettingsDto>("/admin/email-settings", {
      method: "PUT",
      body,
    });
  }

  testEmailSettings(
    body: AdminEmailTestRequest,
  ): Promise<AdminEmailTestResponse> {
    return this.request<AdminEmailTestResponse>("/admin/email-settings/test", {
      method: "POST",
      body,
    });
  }

  // ------------------------------------------- oauth providers (TASK-54)

  listOAuthProviders(): Promise<AdminOAuthProviderDto[]> {
    return this.request<AdminOAuthProviderDto[]>("/admin/oauth-providers");
  }

  updateOAuthProvider(
    provider: string,
    body: AdminUpdateOAuthProviderRequest,
  ): Promise<AdminOAuthProviderDto> {
    return this.request<AdminOAuthProviderDto>(
      `/admin/oauth-providers/${provider}`,
      { method: "PUT", body },
    );
  }

  // ------------------------------------ rate limit & traffic (TASK-57)

  getThrottleSettings(): Promise<AdminThrottleSettingsDto> {
    return this.request<AdminThrottleSettingsDto>("/admin/throttle-settings");
  }

  updateThrottleSettings(
    body: AdminUpdateThrottleSettingsRequest,
  ): Promise<AdminThrottleSettingsDto> {
    return this.request<AdminThrottleSettingsDto>("/admin/throttle-settings", {
      method: "PUT",
      body,
    });
  }

  getTraffic(): Promise<AdminTrafficDto> {
    return this.request<AdminTrafficDto>("/admin/traffic");
  }

  // ------------------------------------------------- demo runner (57)

  getDemo(): Promise<AdminDemoStatusDto> {
    return this.request<AdminDemoStatusDto>("/admin/demo");
  }

  startDemo(body: AdminDemoStartRequest): Promise<AdminDemoStatusDto> {
    return this.request<AdminDemoStatusDto>("/admin/demo/start", {
      method: "POST",
      body,
    });
  }

  stopDemo(): Promise<AdminDemoStatusDto> {
    return this.request<AdminDemoStatusDto>("/admin/demo/stop", {
      method: "POST",
      body: {},
    });
  }

  // ------------------------------------------------- public shares (58)

  listShares(
    params: AdminListParams = {},
  ): Promise<AdminPage<AdminShareRowDto>> {
    return this.request<AdminPage<AdminShareRowDto>>(
      `/admin/shares${this.query(params)}`,
    );
  }

  revokeShare(id: string): Promise<AdminShareRowDto> {
    return this.request<AdminShareRowDto>(
      `/admin/shares/${encodeURIComponent(id)}/revoke`,
      { method: "POST", body: {} },
    );
  }

  // -------------------------------------------- user support (TASK-59)

  resendUserVerification(id: string): Promise<AdminResendVerificationResponse> {
    return this.request<AdminResendVerificationResponse>(
      `/admin/users/${encodeURIComponent(id)}/verification/resend`,
      { method: "POST", body: {} },
    );
  }

  resetUserPassword(id: string): Promise<AdminResetUserPasswordResponse> {
    return this.request<AdminResetUserPasswordResponse>(
      `/admin/users/${encodeURIComponent(id)}/password/reset`,
      { method: "POST", body: {} },
    );
  }

  deleteUser(id: string): Promise<{ status: "ok" }> {
    return this.request<{ status: "ok" }>(
      `/admin/users/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
  }

  promoteUser(id: string): Promise<AdminPromoteUserResponse> {
    return this.request<AdminPromoteUserResponse>(
      `/admin/users/${encodeURIComponent(id)}/promote`,
      { method: "POST", body: {} },
    );
  }

  impersonateUser(id: string): Promise<AdminImpersonationDto> {
    return this.request<AdminImpersonationDto>(
      `/admin/users/${encodeURIComponent(id)}/impersonate`,
      { method: "POST", body: {} },
    );
  }

  demoteMaster(id: string): Promise<{ status: "ok" }> {
    return this.request<{ status: "ok" }>(
      `/admin/admins/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
  }

  exportUser(id: string): Promise<AdminUserExportDto> {
    return this.request<AdminUserExportDto>(
      `/admin/users/${encodeURIComponent(id)}/export`,
    );
  }

  // ------------------------------------------- membership (TASK-60)

  addBoardMember(
    boardId: string,
    body: AdminAddBoardMemberRequest,
  ): Promise<{ status: "ok" }> {
    return this.request<{ status: "ok" }>(
      `/admin/boards/${encodeURIComponent(boardId)}/members`,
      { method: "POST", body },
    );
  }

  updateBoardMember(
    boardId: string,
    memberId: string,
    body: AdminUpdateBoardMemberRequest,
  ): Promise<{ status: "ok" }> {
    return this.request<{ status: "ok" }>(
      `/admin/boards/${encodeURIComponent(boardId)}/members/${encodeURIComponent(memberId)}`,
      { method: "PATCH", body },
    );
  }

  removeBoardMember(
    boardId: string,
    memberId: string,
  ): Promise<{ status: "ok" }> {
    return this.request<{ status: "ok" }>(
      `/admin/boards/${encodeURIComponent(boardId)}/members/${encodeURIComponent(memberId)}`,
      { method: "DELETE" },
    );
  }

  transferOwner(boardId: string, userId: string): Promise<{ status: "ok" }> {
    return this.request<{ status: "ok" }>(
      `/admin/boards/${encodeURIComponent(boardId)}/owner`,
      { method: "POST", body: { userId } },
    );
  }

  deleteAttachment(id: string): Promise<{ status: "ok" }> {
    return this.request<{ status: "ok" }>(
      `/admin/attachments/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
  }

  restoreEntity(entity: AdminEntity, id: string): Promise<{ status: "ok" }> {
    return this.request<{ status: "ok" }>(
      `/admin/entities/${entity}/${encodeURIComponent(id)}/restore`,
      { method: "POST", body: {} },
    );
  }

  bulkEntity(
    entity: AdminEntity,
    ids: string[],
    action: "delete" | "restore" | "archive" | "unarchive",
  ): Promise<AdminBulkResultDto> {
    return this.request<AdminBulkResultDto>(`/admin/entities/${entity}/bulk`, {
      method: "POST",
      body: { ids, action },
    });
  }

  // ----------------------------------------------- flags + ops (TASK-61)

  listFlags(): Promise<AdminFeatureFlagDto[]> {
    return this.request<AdminFeatureFlagDto[]>("/admin/flags");
  }

  updateFlag(
    key: string,
    body: AdminUpdateFeatureFlagRequest,
  ): Promise<AdminFeatureFlagDto> {
    return this.request<AdminFeatureFlagDto>(
      `/admin/flags/${encodeURIComponent(key)}`,
      { method: "PATCH", body },
    );
  }

  getOps(): Promise<AdminOpsSettingsDto> {
    return this.request<AdminOpsSettingsDto>("/admin/ops");
  }

  updateOps(body: AdminUpdateOpsSettingsRequest): Promise<AdminOpsSettingsDto> {
    return this.request<AdminOpsSettingsDto>("/admin/ops", {
      method: "PUT",
      body,
    });
  }

  // -------------------------------------------------------- comms (TASK-62)

  listAnnouncements(): Promise<AdminAnnouncementDto[]> {
    return this.request<AdminAnnouncementDto[]>("/admin/announcements");
  }

  createAnnouncement(
    body: AdminCreateAnnouncementRequest,
  ): Promise<AdminAnnouncementDto> {
    return this.request<AdminAnnouncementDto>("/admin/announcements", {
      method: "POST",
      body,
    });
  }

  updateAnnouncement(
    id: string,
    body: AdminUpdateAnnouncementRequest,
  ): Promise<AdminAnnouncementDto> {
    return this.request<AdminAnnouncementDto>(
      `/admin/announcements/${encodeURIComponent(id)}`,
      { method: "PATCH", body },
    );
  }

  deleteAnnouncement(id: string): Promise<{ status: "ok" }> {
    return this.request<{ status: "ok" }>(
      `/admin/announcements/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
  }

  sendEmail(body: AdminSendEmailRequest): Promise<AdminSendEmailResponse> {
    return this.request<AdminSendEmailResponse>("/admin/email/send", {
      method: "POST",
      body,
    });
  }

  listEmailTemplates(): Promise<AdminEmailTemplateDto[]> {
    return this.request<AdminEmailTemplateDto[]>("/admin/email-templates");
  }

  updateEmailTemplate(
    key: string,
    body: { subject: string; bodyHtml: string },
  ): Promise<AdminEmailTemplateDto> {
    return this.request<AdminEmailTemplateDto>(
      `/admin/email-templates/${encodeURIComponent(key)}`,
      { method: "PUT", body },
    );
  }

  // -------------------------------------------- data/compliance (TASK-63)

  getRetention(): Promise<AdminRetentionDto> {
    return this.request<AdminRetentionDto>("/admin/retention");
  }

  purgeSoftDeleted(): Promise<AdminBulkResultDto> {
    return this.request<AdminBulkResultDto>("/admin/retention/purge", {
      method: "POST",
      body: {},
    });
  }

  // -------------------------------------------- observability (TASK-64)

  getObservability(): Promise<AdminObservabilityDto> {
    return this.request<AdminObservabilityDto>("/admin/observability");
  }

  // --------------------------------------------------- security (TASK-65)

  getSecurity(): Promise<AdminSecurityDto> {
    return this.request<AdminSecurityDto>("/admin/security");
  }

  setupTotp(): Promise<AdminTotpSetupDto> {
    return this.request<AdminTotpSetupDto>("/admin/security/totp", {
      method: "POST",
      body: {},
    });
  }

  verifyTotp(code: string): Promise<{ totpEnabled: true }> {
    return this.request<{ totpEnabled: true }>("/admin/security/totp/verify", {
      method: "POST",
      body: { code },
    });
  }

  updateSecurity(body: AdminUpdateSecurityRequest): Promise<AdminSecurityDto> {
    return this.request<AdminSecurityDto>("/admin/security", {
      method: "PUT",
      body,
    });
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
    if (params.from !== undefined) search.set("from", String(params.from));
    if (params.to !== undefined) search.set("to", String(params.to));
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

/** The admin-wide client, isolated from the user `api` singleton. */
export const adminApi = new AdminApiClient();
