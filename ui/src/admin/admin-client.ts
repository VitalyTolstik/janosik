import type {
  AdminAuditRowDto,
  AdminAuthResponseDto,
  AdminBoardCommandRequest,
  AdminBoardDetailDto,
  AdminBoardRowDto,
  AdminCardDetailDto,
  AdminCardDetailQuery,
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
  AdminFilterOptionsDto,
  AdminFilterOptionsQuery,
  AdminFilters,
  AdminGlobalSearchDto,
  AdminListSurface,
  AdminMasterRowDto,
  AdminMasterAllowlistDto,
  AdminSessionRowDto,
  AdminTokenRowDto,
  AdminMetricsDto,
  AdminShareRowDto,
  AdminPage,
  AdminAnnouncementDto,
  AdminBulkResultDto,
  AdminCreateAnnouncementRequest,
  AdminEmailTemplateDto,
  AdminExportRowDto,
  AdminMaintenanceRunResponse,
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
  AdminTotpSetupRequest,
  AdminVerifyTotpResponse,
  AdminUpdateAnnouncementRequest,
  AdminUpdateFeatureFlagRequest,
  AdminUpdateOpsSettingsRequest,
  AdminUpdateSecurityRequest,
  AdminAddBoardMemberRequest,
  AdminUpdateBoardMemberRequest,
  AdminUpdateEmailSettingsRequest,
  AdminUpdateMasterRequest,
  AdminUpdateUserRequest,
  AdminUserDetailDto,
  AdminUserDetailQuery,
  AdminUserDto,
  AdminUserRowDto,
  BoardAggregate,
  CommandResponse,
} from "@janosik/shared";
import { ApiError, apiBaseUrl } from "@/api/client";

export class AdminRequestTimeoutError extends Error {
  constructor() {
    super("admin_request_timeout");
    this.name = "AdminRequestTimeoutError";
  }
}

/** Bound one-time-secret mutations so a hung request cannot trap a dialog. */
export const ADMIN_SECRET_REQUEST_TIMEOUT_MS = 15_000;

export async function withAdminRequestTimeout<T>(
  start: (signal: AbortSignal) => Promise<T>,
  timeoutMs = ADMIN_SECRET_REQUEST_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AdminRequestTimeoutError());
    }, timeoutMs);
  });
  try {
    return await Promise.race([start(controller.signal), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
  }
}

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

export interface AdminListParams extends AdminFilters {
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
  signal?: AbortSignal;
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

  refreshSession(
    options: { signal?: AbortSignal } = {},
  ): Promise<AdminAuthResponseDto | null> {
    if (this.refreshPromise === null) {
      this.refreshPromise = this.runRefresh(options.signal).finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  private async runRefresh(
    signal?: AbortSignal,
  ): Promise<AdminAuthResponseDto | null> {
    try {
      const response = await this.request<AdminAuthResponseDto>(
        "/admin/auth/refresh",
        { method: "POST", body: {}, auth: false, signal },
      );
      this.accessToken = response.accessToken;
      return response;
    } catch (error) {
      // QA-A3: only an explicit "no session" answer logs the master out.
      // A throttle (429), a 5xx or a network failure is transient: keep the
      // current session and let the caller retry/back off instead of showing
      // the sign-in screen.
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.status === 403)
      ) {
        this.accessToken = null;
        return null;
      }
      throw error;
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
    return this.list(`/admin/entities/${entity}`, entity, params);
  }

  /** Cross-entity top matches for the panel omnibox. */
  globalSearch(
    query: string,
    signal?: AbortSignal,
  ): Promise<AdminGlobalSearchDto> {
    const params = new URLSearchParams({ q: query });
    return this.request<AdminGlobalSearchDto>(
      `/admin/search?${params.toString()}`,
      { signal },
    );
  }

  userDetail(
    userId: string,
    params: AdminUserDetailQuery = {},
  ): Promise<AdminUserDetailDto> {
    return this.request<AdminUserDetailDto>(
      `/admin/users/${encodeURIComponent(userId)}/detail${this.detailQuery(params)}`,
    );
  }

  cardDetail(
    cardId: string,
    params: AdminCardDetailQuery = {},
  ): Promise<AdminCardDetailDto> {
    return this.request<AdminCardDetailDto>(
      `/admin/cards/${encodeURIComponent(cardId)}/detail${this.detailQuery(params)}`,
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

  getMasterAllowlist(masterId: string): Promise<AdminMasterAllowlistDto> {
    return this.request<AdminMasterAllowlistDto>(
      `/admin/masters/${encodeURIComponent(masterId)}/allowlist`,
    );
  }

  updateMasterAllowlist(
    masterId: string,
    body: AdminMasterAllowlistDto,
  ): Promise<AdminMasterAllowlistDto> {
    return this.request<AdminMasterAllowlistDto>(
      `/admin/masters/${encodeURIComponent(masterId)}/allowlist`,
      {
        method: "PUT",
        body,
      },
    );
  }

  createMaster(
    body: AdminCreateMasterRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<AdminCreateMasterResponse> {
    return this.request<AdminCreateMasterResponse>("/admin/admins", {
      method: "POST",
      body,
      signal: options.signal,
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

  resetMasterPassword(
    masterId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<AdminCreateMasterResponse> {
    return this.request<AdminCreateMasterResponse>(
      `/admin/admins/${masterId}/password/reset`,
      { method: "POST", signal: options.signal },
    );
  }

  revokeMasterSessions(masterId: string): Promise<{ revoked: number }> {
    return this.request<{ revoked: number }>(
      `/admin/admins/${masterId}/sessions/revoke`,
      { method: "POST" },
    );
  }

  listUsers(params: AdminListParams = {}): Promise<AdminPage<AdminUserRowDto>> {
    return this.list("/admin/users", "users", params);
  }

  createUser(
    body: AdminCreateUserRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<AdminCreateUserResponse> {
    return this.request<AdminCreateUserResponse>("/admin/users", {
      method: "POST",
      body,
      signal: options.signal,
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
    return this.list("/admin/boards", "boards", params);
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
    return this.list("/admin/cards", "cards", params);
  }

  filterOptions(
    { type, ids, q, limit, boardId, columnId, cardId }: AdminFilterOptionsQuery,
    signal?: AbortSignal,
  ): Promise<AdminFilterOptionsDto> {
    const params = new URLSearchParams({ type });
    if (ids !== undefined) {
      for (const id of ids) params.append("ids", id);
    } else {
      if (q) params.set("q", q);
      if (limit !== undefined) params.set("limit", String(limit));
      if (boardId) params.set("boardId", boardId);
      if (columnId) params.set("columnId", columnId);
      if (cardId) params.set("cardId", cardId);
    }
    return this.request<AdminFilterOptionsDto>(
      `/admin/filter-options?${params}`,
      { signal },
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
    return this.list("/admin/sessions", "sessions", params);
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
    return this.list("/admin/tokens", "tokens", params);
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
    return this.list("/admin/comments", "comments", params);
  }

  deleteComment(commentId: string): Promise<{ status: "ok" }> {
    return this.request<{ status: "ok" }>(`/admin/comments/${commentId}`, {
      method: "DELETE",
    });
  }

  listCommands(
    params: AdminListParams = {},
  ): Promise<AdminPage<AdminCommandRowDto>> {
    return this.list("/admin/commands", "commands", params);
  }

  listAudit(
    params: AdminListParams = {},
  ): Promise<AdminPage<AdminAuditRowDto>> {
    return this.list("/admin/audit", "audit", params);
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
    return this.list("/admin/shares", "shares", params);
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

  resetUserPassword(
    id: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<AdminResetUserPasswordResponse> {
    return this.request<AdminResetUserPasswordResponse>(
      `/admin/users/${encodeURIComponent(id)}/password/reset`,
      { method: "POST", body: {}, signal: options.signal },
    );
  }

  deleteUser(id: string): Promise<{ status: "ok" }> {
    return this.request<{ status: "ok" }>(
      `/admin/users/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
  }

  promoteUser(
    id: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<AdminPromoteUserResponse> {
    return this.request<AdminPromoteUserResponse>(
      `/admin/users/${encodeURIComponent(id)}/promote`,
      { method: "POST", body: {}, signal: options.signal },
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

  /** Drop an override so the built-in letter takes over again. */
  resetEmailTemplate(key: string): Promise<AdminEmailTemplateDto> {
    return this.request<AdminEmailTemplateDto>(
      `/admin/email-templates/${encodeURIComponent(key)}`,
      { method: "DELETE" },
    );
  }

  // -------------------------------------------- data/compliance (TASK-63)

  getRetention(retentionDays?: number): Promise<AdminRetentionDto> {
    const query =
      retentionDays === undefined
        ? ""
        : `?retentionDays=${encodeURIComponent(String(retentionDays))}`;
    return this.request<AdminRetentionDto>(`/admin/retention${query}`);
  }

  /** Hard-delete soft-deleted rows. The visible window is always sent so the
   * server never falls back to a different saved setting (QA-A1). */
  purgeSoftDeleted(retentionDays: number): Promise<AdminBulkResultDto> {
    return this.request<AdminBulkResultDto>("/admin/retention/purge", {
      method: "POST",
      body: { retentionDays },
    });
  }

  // --------------------------------------------- maintenance (TASK-68)

  runMaintenance(job: string): Promise<AdminMaintenanceRunResponse> {
    return this.request<AdminMaintenanceRunResponse>("/admin/maintenance/run", {
      method: "POST",
      body: { job },
    });
  }

  // ---------------------------------------------- exports (TASK-71)

  requestExport(id: string): Promise<AdminExportRowDto> {
    return this.request<AdminExportRowDto>(
      `/admin/users/${encodeURIComponent(id)}/export`,
      { method: "POST", body: {} },
    );
  }

  listExports(): Promise<AdminExportRowDto[]> {
    return this.request<AdminExportRowDto[]>("/admin/exports");
  }

  /** Download a ready export artifact (admin guard, so a blob fetch). */
  async downloadExport(id: string): Promise<Blob> {
    const base = this.options.baseUrl ?? apiBaseUrl();
    const headers: Record<string, string> = {};
    if (this.accessToken !== null) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const response = await fetchImpl(
      `${base}/admin/exports/${encodeURIComponent(id)}/download`,
      { headers, credentials: "include" },
    );
    if (!response.ok) throw new ApiError(response.status, null);
    return response.blob();
  }

  // ------------------------------------------------ queues (TASK-73)

  async requestQueueTicket(): Promise<void> {
    await this.request<{ ok: true }>("/admin/queue-ticket", {
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

  setupTotp(proof: AdminTotpSetupRequest = {}): Promise<AdminTotpSetupDto> {
    return this.request<AdminTotpSetupDto>("/admin/security/totp", {
      method: "POST",
      body: proof,
    });
  }

  verifyTotp(
    code: string,
    setupToken: string,
  ): Promise<AdminVerifyTotpResponse> {
    return this.request<AdminVerifyTotpResponse>(
      "/admin/security/totp/verify",
      {
        method: "POST",
        body: { code, setupToken },
      },
    );
  }

  updateSecurity(body: AdminUpdateSecurityRequest): Promise<AdminSecurityDto> {
    return this.request<AdminSecurityDto>("/admin/security", {
      method: "PUT",
      body,
    });
  }

  /** Query of the paged detail tabs (TASK-176.3). */
  private detailQuery(
    params: AdminUserDetailQuery | AdminCardDetailQuery,
  ): string {
    const search = new URLSearchParams();
    if (params.section) search.set("section", params.section);
    if (params.limit !== undefined) search.set("limit", String(params.limit));
    if (params.offset !== undefined)
      search.set("offset", String(params.offset));
    if (params.includeDeleted === true) search.set("includeDeleted", "true");
    if ("anchor" in params && params.anchor) {
      search.set("anchor", params.anchor);
    }
    const value = search.toString();
    return value === "" ? "" : `?${value}`;
  }

  private async list<T>(
    path: string,
    surface: AdminListSurface,
    params: AdminListParams,
  ): Promise<AdminPage<T>> {
    // Keep list serialization off auth and detail routes that share this client.
    const { adminListRequestQuery } = await import("./admin-list-request");
    return this.request<AdminPage<T>>(
      `${path}${adminListRequestQuery(params, surface)}`,
    );
  }

  private async request<T>(
    path: string,
    init: RequestInitLike = {},
  ): Promise<T> {
    try {
      return await this.attempt<T>(path, init);
    } catch (error) {
      if (
        !init.signal?.aborted &&
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
        signal: init.signal,
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
