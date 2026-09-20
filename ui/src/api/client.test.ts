import { describe, expect, it, vi } from "vitest";

import type { AuthUserDto } from "@janosik/shared";
import { ApiClient, ApiError } from "@/api/client";

const user: AuthUserDto = {
  id: "u-1",
  email: "admin@example.com",
  displayName: "Admin",
  avatarColor: null,
  avatarPath: null,
  createdAt: 0,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function pathOf(input: RequestInfo | URL): string {
  return new URL(
    typeof input === "string" ? input : input.toString(),
    "http://api.test",
  ).pathname;
}

function headerOf(init: RequestInit | undefined, name: string): string | null {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  return headers[name] ?? null;
}

describe("ApiClient", () => {
  it("logs in, keeps the token in memory and attaches it to later calls", async () => {
    const calls: Array<{ path: string; auth: string | null }> = [];
    const client = new ApiClient({
      baseUrl: "/api/v1",
      fetchImpl: async (input, init) => {
        calls.push({
          path: pathOf(input),
          auth: headerOf(init, "Authorization"),
        });
        if (pathOf(input) === "/api/v1/auth/login") {
          return json({ accessToken: "access-1", user });
        }
        return json(user);
      },
    });

    await client.login("admin@example.com", "password123");
    expect(client.getAccessToken()).toBe("access-1");
    await client.me();
    expect(calls[1]).toEqual({
      path: "/api/v1/auth/me",
      auth: "Bearer access-1",
    });
  });

  it("shares one refresh across parallel 401s and retries each call once", async () => {
    let refreshes = 0;
    const client = new ApiClient({
      baseUrl: "/api/v1",
      fetchImpl: async (input, init) => {
        const path = pathOf(input);
        if (path.endsWith("/auth/login")) {
          return json({ accessToken: "stale", user });
        }
        if (path.endsWith("/auth/refresh")) {
          refreshes += 1;
          return json({ accessToken: "fresh", user });
        }
        return headerOf(init, "Authorization") === "Bearer fresh"
          ? json(user)
          : json({ message: "Unauthorized" }, 401);
      },
    });

    await client.login("admin@example.com", "password123");
    const [a, b] = await Promise.all([client.me(), client.me()]);
    expect(a).toEqual(user);
    expect(b).toEqual(user);
    expect(refreshes).toBe(1);
  });

  it("serializes the refresh across tabs through the Web Locks API", async () => {
    const events: string[] = [];
    let queue: Promise<unknown> = Promise.resolve();
    const locks = {
      request(name: string, task: () => Promise<unknown>) {
        events.push(`lock:${name}`);
        const run = queue.then(task);
        queue = run.catch(() => undefined);
        return run;
      },
    };
    Object.defineProperty(navigator, "locks", {
      value: locks,
      configurable: true,
    });

    // Two clients = two tabs of the same profile: same refresh cookie, but
    // neither can see the other's in-flight promise.
    const tab = (tag: string) => {
      const client = new ApiClient({
        baseUrl: "/api/v1",
        fetchImpl: async (input) => {
          if (pathOf(input).endsWith("/auth/refresh")) {
            events.push(`${tag}:start`);
            await new Promise((resolve) => setTimeout(resolve, 10));
            events.push(`${tag}:end`);
            return json({ accessToken: `${tag}-token`, user });
          }
          return json(user);
        },
      });
      return client;
    };

    try {
      const [a, b] = await Promise.all([
        tab("tab-a").refreshSession(),
        tab("tab-b").refreshSession(),
      ]);
      expect(a?.accessToken).toBe("tab-a-token");
      expect(b?.accessToken).toBe("tab-b-token");
      // The second rotation waited for the first to finish — without the
      // lock both would present the same cookie and the server would revoke
      // every session as a reuse signal.
      expect(events.indexOf("tab-b:start")).toBeGreaterThan(
        events.indexOf("tab-a:end"),
      );
      expect(
        events.filter((event) => event === "lock:janosik:auth-refresh"),
      ).toHaveLength(2);
    } finally {
      delete (navigator as { locks?: unknown }).locks;
    }
  });

  it("does not let a stale boot refresh clobber a login that landed later", async () => {
    const pending: { resolve?: (response: Response) => void } = {};
    const client = new ApiClient({
      baseUrl: "/api/v1",
      fetchImpl: async (input) => {
        if (pathOf(input).endsWith("/auth/refresh")) {
          return new Promise<Response>((resolve) => {
            pending.resolve = resolve;
          });
        }
        return json({ accessToken: "login-token", user });
      },
    });

    // The boot refresh hangs; the user logs in meanwhile.
    const boot = client.refreshSession();
    await client.login("admin@example.com", "password123");
    expect(client.getAccessToken()).toBe("login-token");

    // The late 401 of the stale refresh must not wipe the fresh token.
    pending.resolve?.(json({ message: "Unauthorized" }, 401));
    await expect(boot).resolves.toBeNull();
    expect(client.getAccessToken()).toBe("login-token");
  });

  it("does not let a stale refresh overwrite a newer login (account switch)", async () => {
    const pending: { resolve?: (response: Response) => void } = {};
    const client = new ApiClient({
      baseUrl: "/api/v1",
      fetchImpl: async (input) => {
        if (pathOf(input).endsWith("/auth/refresh")) {
          return new Promise<Response>((resolve) => {
            pending.resolve = resolve;
          });
        }
        return json({ accessToken: "b-token", user: { ...user, id: "u-2" } });
      },
    });

    const boot = client.refreshSession();
    await client.login("other@example.com", "password123");

    pending.resolve?.(json({ accessToken: "a-token", user }));
    await expect(boot).resolves.toBeNull();
    expect(client.getAccessToken()).toBe("b-token");
  });

  it("reports a dead session once and clears the token", async () => {
    const onAuthLost = vi.fn();
    const client = new ApiClient({
      baseUrl: "/api/v1",
      fetchImpl: async (input) => {
        if (pathOf(input).endsWith("/auth/login")) {
          return json({ accessToken: "access-1", user });
        }
        return json({ message: "Unauthorized" }, 401);
      },
    });
    client.onAuthLost = onAuthLost;

    await client.login("admin@example.com", "password123");
    await expect(client.me()).rejects.toBeInstanceOf(ApiError);
    expect(onAuthLost).toHaveBeenCalledTimes(1);
    expect(client.getAccessToken()).toBeNull();
  });

  it("turns a transport failure into an offline error", async () => {
    const client = new ApiClient({
      baseUrl: "/api/v1",
      fetchImpl: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const error = await client.listBoards().catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).offline).toBe(true);
    expect((error as ApiError).status).toBe(0);
  });

  it("exposes the conflict category and the rejected field", async () => {
    const conflict = new ApiError(409, { conflict: "wip", currentVersion: 3 });
    expect(conflict.conflict).toBe("wip");
    const rejected = new ApiError(400, { message: "bad", field: "action.at" });
    expect(rejected.field).toBe("action.at");
    expect(rejected.messageText).toBe("bad");
  });

  it("posts commands to the board endpoint with keepalive", async () => {
    const paths: string[] = [];
    let keepalive: boolean | undefined;
    const client = new ApiClient({
      baseUrl: "/api/v1",
      fetchImpl: async (input, init) => {
        paths.push(`${init?.method} ${pathOf(input)}`);
        keepalive = init?.keepalive;
        return json({ seq: 7, versions: { "card:c-1": 2 } });
      },
    });
    const response = await client.sendCommand("b-1", {
      commandId: "cd-1",
      action: { type: "DELETE_CARD", cardId: "c-1", at: 1 },
    });
    expect(response.seq).toBe(7);
    expect(paths).toEqual(["POST /api/v1/boards/b-1/commands"]);
    // A reload right after Enter must not kill the in-flight command: the
    // browser finishes it even after the page is gone.
    expect(keepalive).toBe(true);
  });

  it("talks to the comment and activity endpoints (TASK-37)", async () => {
    const calls: Array<{ method: string; url: string; body: unknown }> = [];
    const client = new ApiClient({
      baseUrl: "/api/v1",
      fetchImpl: async (input, init) => {
        calls.push({
          method: init?.method ?? "GET",
          url: `${pathOf(input)}${
            new URL(
              typeof input === "string" ? input : input.toString(),
              "http://api.test",
            ).search
          }`,
          body:
            typeof init?.body === "string"
              ? (JSON.parse(init.body) as unknown)
              : undefined,
        });
        if ((init?.method ?? "GET") === "DELETE") {
          return json({ status: "ok" });
        }
        if ((init?.method ?? "GET") === "POST") {
          return json({
            id: "comment-1",
            cardId: "c-1",
            authorId: "u-1",
            text: "hi",
            createdAt: 1,
          });
        }
        return json({ items: [], nextCursor: null });
      },
    });

    await client.listComments("c-1", "50:abc", 20);
    await client.createComment("c-1", "hi");
    await client.deleteComment("comment-1");
    await client.cardActivity("c-1", "at:c:7");
    expect(calls).toEqual([
      {
        method: "GET",
        url: "/api/v1/cards/c-1/comments?cursor=50%3Aabc&limit=20",
        body: undefined,
      },
      {
        method: "POST",
        url: "/api/v1/cards/c-1/comments",
        body: { text: "hi" },
      },
      { method: "DELETE", url: "/api/v1/comments/comment-1", body: undefined },
      {
        method: "GET",
        url: "/api/v1/cards/c-1/activity?cursor=at%3Ac%3A7",
        body: undefined,
      },
    ]);
  });
});
