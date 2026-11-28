import { describe, expect, it } from "vitest";

import { ApiClient, ApiError } from "@/api/client";

/**
 * TASK-177.7 (G-14/G-15): the client keeps the server's exact export string
 * and exposes the Recently deleted read/restore routes.
 */
describe("ApiClient — per-board export + Recently deleted", () => {
  it("returns the export response as text and preserves a 413", async () => {
    const seen: Array<{ path: string; auth: string | null }> = [];
    const client = new ApiClient({
      baseUrl: "/api/v1",
      fetchImpl: async (input, init) => {
        const path = new URL(
          typeof input === "string" ? input : input.toString(),
          "http://api.test",
        ).pathname;
        seen.push({
          path,
          auth:
            ((init?.headers ?? {}) as Record<string, string>).Authorization ??
            null,
        });
        return new Response('{"app":"janosik","schemaVersion":4}', {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        });
      },
    });
    client.setAccessToken("token-1");

    await expect(client.exportBoard("b/1")).resolves.toBe(
      '{"app":"janosik","schemaVersion":4}',
    );
    expect(seen).toEqual([
      { path: "/api/v1/boards/b%2F1/export", auth: "Bearer token-1" },
    ]);

    const tooLarge = new ApiClient({
      baseUrl: "/api/v1",
      fetchImpl: async () =>
        new Response(JSON.stringify({ code: "payload_too_large" }), {
          status: 413,
          headers: { "Content-Type": "application/json" },
        }),
    });
    await expect(tooLarge.exportBoard("b-1")).rejects.toMatchObject({
      status: 413,
    });
    await expect(tooLarge.exportBoard("b-1")).rejects.toBeInstanceOf(ApiError);
  });

  it("reads and restores a deleted item on the board-scoped routes", async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const client = new ApiClient({
      baseUrl: "/api/v1",
      fetchImpl: async (input, init) => {
        calls.push({
          method: init?.method ?? "GET",
          path: new URL(
            typeof input === "string" ? input : input.toString(),
            "http://api.test",
          ).pathname,
        });
        return new Response(
          JSON.stringify(
            init?.method === "POST"
              ? { status: "ok" }
              : { retentionDays: 30, limit: 200, items: [], truncated: false },
          ),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    });

    await expect(client.listDeleted("b-1")).resolves.toEqual({
      retentionDays: 30,
      limit: 200,
      items: [],
      truncated: false,
    });
    await expect(
      client.restoreDeleted("b-1", "comments", "c 1"),
    ).resolves.toEqual({ status: "ok" });
    expect(calls).toEqual([
      { method: "GET", path: "/api/v1/boards/b-1/deleted" },
      {
        method: "POST",
        path: "/api/v1/boards/b-1/deleted/comments/c%201/restore",
      },
    ]);
  });
});
