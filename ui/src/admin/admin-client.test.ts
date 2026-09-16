import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@/api/client";
import { AdminApiClient } from "./admin-client";

/**
 * Admin transport (TASK-36): token handling, single-flight refresh, retry
 * policy, query building and error mapping — the security-relevant surface
 * of the master contour.
 */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function makeFetch(
  handler: (call: Call, index: number) => Response | Promise<Response>,
): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: typeof input === "string" ? input : input.toString(),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return handler(call, calls.length - 1);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const ADMIN = {
  id: "master-1",
  email: "master@example.com",
  displayName: "Master",
  createdAt: 1,
  lastLoginAt: null,
};

function client(
  handler: (call: Call, index: number) => Response | Promise<Response>,
): { api: AdminApiClient; calls: Call[] } {
  const { fetchImpl, calls } = makeFetch(handler);
  return {
    api: new AdminApiClient({ baseUrl: "http://api.test/api/v1", fetchImpl }),
    calls,
  };
}

describe("AdminApiClient", () => {
  let onAuthLost: () => void;
  let lostCalls = 0;

  beforeEach(() => {
    lostCalls = 0;
    onAuthLost = () => {
      lostCalls += 1;
    };
  });

  it("stores the token from login and sends it as a Bearer header", async () => {
    const { api, calls } = client((call) =>
      call.url.endsWith("/admin/auth/login")
        ? json({ accessToken: "token-1", admin: ADMIN })
        : json({ items: [], total: 0, limit: 50, offset: 0 }),
    );
    await api.login("master@example.com", "secret");
    expect(api.getAccessToken()).toBe("token-1");

    await api.listUsers();
    expect(calls[1].headers.Authorization).toBe("Bearer token-1");
    // Credentials ride cookies: the httpOnly refresh cookie is the only
    // cross-request secret, never a header.
    expect(calls[1].headers.cookie).toBeUndefined();
  });

  it("never attaches the token to login/refresh calls", async () => {
    const { api, calls } = client(() =>
      json({ accessToken: "token-1", admin: ADMIN }),
    );
    await api.login("master@example.com", "secret");
    await api.refreshSession();
    expect(calls[0].headers.Authorization).toBeUndefined();
    expect(calls[1].headers.Authorization).toBeUndefined();
  });

  it("retries exactly once after a refresh on 401", async () => {
    const { api, calls } = client((call, index) => {
      if (call.url.endsWith("/admin/auth/refresh")) {
        return json({ accessToken: "token-2", admin: ADMIN });
      }
      if (call.url.endsWith("/admin/metrics")) {
        return index === 0
          ? json({ message: "expired" }, 401)
          : json({ ok: true });
      }
      return json({ message: "unexpected" }, 500);
    });
    api.clearAccessToken();
    const result = await api.metrics();
    expect(result).toEqual({ ok: true });
    expect(calls.map((call) => call.url)).toEqual([
      "http://api.test/api/v1/admin/metrics",
      "http://api.test/api/v1/admin/auth/refresh",
      "http://api.test/api/v1/admin/metrics",
    ]);
    expect(api.getAccessToken()).toBe("token-2");
  });

  it("single-flights parallel refreshes", async () => {
    const { api, calls } = client((call) => {
      if (call.url.endsWith("/admin/auth/refresh")) {
        return json({ accessToken: "token-2", admin: ADMIN });
      }
      return json({ message: "expired" }, 401);
    });
    const [first, second] = await Promise.all([
      api.refreshSession(),
      api.refreshSession(),
    ]);
    expect(first?.accessToken).toBe("token-2");
    expect(second?.accessToken).toBe("token-2");
    expect(calls.filter((call) => call.url.includes("/refresh"))).toHaveLength(
      1,
    );
  });

  it("reports a lost session when the refresh fails, exactly once", async () => {
    const { api } = client((call) =>
      call.url.endsWith("/admin/auth/refresh")
        ? json({ message: "no" }, 401)
        : json({ message: "expired" }, 401),
    );
    api.clearAccessToken();
    api.onAuthLost = onAuthLost;
    await expect(api.metrics()).rejects.toBeInstanceOf(ApiError);
    expect(lostCalls).toBe(1);
    expect(api.getAccessToken()).toBeNull();
  });

  it("maps transport failures to offline ApiError", async () => {
    const api = new AdminApiClient({
      baseUrl: "http://api.test/api/v1",
      fetchImpl: (() => Promise.reject(new Error("down"))) as typeof fetch,
    });
    const error = await api.metrics().catch((cause) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
    expect(error.offline).toBe(true);
  });

  it("closes the session locally even if logout fails", async () => {
    const { api } = client(() => json({ message: "boom" }, 500));
    api.onAuthLost = onAuthLost;
    await expect(api.logout()).rejects.toBeInstanceOf(ApiError);
    expect(api.getAccessToken()).toBeNull();
    // logout must never trigger the auth-lost callback.
    expect(lostCalls).toBe(0);
  });

  it("builds list queries and drops the 'all' status", async () => {
    const { api, calls } = client(() =>
      json({ items: [], total: 0, limit: 10, offset: 20 }),
    );
    await api.listUsers({
      search: "a b",
      status: "disabled",
      limit: 10,
      offset: 20,
    });
    const url = new URL(calls[0].url);
    expect(url.searchParams.get("search")).toBe("a b");
    expect(url.searchParams.get("status")).toBe("disabled");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.get("offset")).toBe("20");

    await api.listUsers({ status: "all" });
    expect(calls[1].url).not.toContain("status=");
  });

  it("covers every admin endpoint path and method", async () => {
    const { api, calls } = client((call) => {
      if (call.url.endsWith("/admin/users"))
        return json({ items: [], total: 0, limit: 50, offset: 0 });
      if (call.url.includes("/admin/users/")) return json(ADMIN);
      if (call.url.endsWith("/admin/boards"))
        return json({ items: [], total: 0, limit: 50, offset: 0 });
      if (call.url.includes("/admin/boards/")) return json({ status: "ok" });
      if (call.url.endsWith("/admin/commands"))
        return json({ items: [], total: 0, limit: 50, offset: 0 });
      if (call.url.endsWith("/admin/audit"))
        return json({ items: [], total: 0, limit: 50, offset: 0 });
      return json({});
    });
    api.clearAccessToken();
    await api.listBoards();
    await api.createBoard({ title: "T", ownerEmail: "o@example.com" });
    await api.archiveBoard("b-1");
    await api.unarchiveBoard("b-1");
    await api.deleteBoard("b-1");
    await api.createUser({ email: "u@example.com" });
    await api.updateUser("u-1", { disabled: true });
    await api.revokeUserSessions("u-1");
    await api.revokeUserTokens("u-1");
    await api.listCommands();
    await api.listAudit();

    expect(
      calls.map((call) => `${call.method} ${new URL(call.url).pathname}`),
    ).toEqual([
      "GET /api/v1/admin/boards",
      "POST /api/v1/admin/boards",
      "POST /api/v1/admin/boards/b-1/archive",
      "POST /api/v1/admin/boards/b-1/unarchive",
      "DELETE /api/v1/admin/boards/b-1",
      "POST /api/v1/admin/users",
      "PATCH /api/v1/admin/users/u-1",
      "POST /api/v1/admin/users/u-1/sessions/revoke",
      "POST /api/v1/admin/users/u-1/tokens/revoke",
      "GET /api/v1/admin/commands",
      "GET /api/v1/admin/audit",
    ]);
  });
});
