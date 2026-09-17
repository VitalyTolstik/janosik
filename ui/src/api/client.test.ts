import { describe, expect, it, vi } from "vitest";

import type { AuthUserDto } from "@janosik/shared";
import { ApiClient, ApiError } from "@/api/client";

const user: AuthUserDto = {
  id: "u-1",
  email: "admin@example.com",
  displayName: "Admin",
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
});
