import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";

import type { AuthUserDto } from "@janosik/shared";
import { api } from "@/api/client";
import { AuthProvider, useAuth } from "@/auth/AuthContext";
import {
  consumeImpersonationHash,
  getImpersonationToken,
  isImpersonationToken,
} from "@/impersonation";
import { appPath } from "@/utils/app-path";

/**
 * U-8: the `#impersonate=` hash is a login-CSRF vector — only a genuine
 * impersonation token (the `imp` claim a master mint carries), on the
 * dedicated route, is adopted. Everything else is cleared and ignored.
 */

function jwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value))
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(claims)}.signature`;
}

const future = Math.floor(Date.now() / 1000) + 600;
const IMPERSONATION = jwt({ sub: "user-9", imp: "master-1", exp: future });
const ORDINARY = jwt({ sub: "attacker", exp: future });

function visit(path: string, token: string) {
  window.history.replaceState(
    null,
    "",
    `${appPath(path)}#impersonate=${encodeURIComponent(token)}`,
  );
}

describe("impersonation hash (U-8)", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    window.history.replaceState(null, "", "/");
    sessionStorage.clear();
  });

  it("recognises only unexpired tokens that carry the imp claim", () => {
    expect(isImpersonationToken(IMPERSONATION)).toBe(true);
    expect(isImpersonationToken(ORDINARY)).toBe(false);
    expect(
      isImpersonationToken(jwt({ sub: "u", imp: "m", exp: 1 }), Date.now()),
    ).toBe(false);
    expect(isImpersonationToken("not-a-jwt")).toBe(false);
    expect(isImpersonationToken(jwt({ sub: "u", imp: "" }))).toBe(false);
  });

  it("adopts an impersonation token on the dedicated route", () => {
    visit("/impersonate", IMPERSONATION);
    expect(consumeImpersonationHash()).toBe(IMPERSONATION);
    expect(window.location.hash).toBe("");
    expect(getImpersonationToken()).toBe(IMPERSONATION);
  });

  it("refuses an ordinary access token — the login-CSRF link", () => {
    visit("/impersonate", ORDINARY);
    expect(consumeImpersonationHash()).toBeNull();
    // Gone from the URL, never stored.
    expect(window.location.hash).toBe("");
    expect(getImpersonationToken()).toBeNull();
  });

  it("refuses the hash on any other route, even with a valid token", () => {
    visit("/", IMPERSONATION);
    expect(consumeImpersonationHash()).toBeNull();
    expect(window.location.hash).toBe("");
    visit("/board/b-1", IMPERSONATION);
    expect(consumeImpersonationHash()).toBeNull();
    expect(getImpersonationToken()).toBeNull();
  });

  it("drops a stored token that does not qualify", () => {
    sessionStorage.setItem("janosik.impersonation", ORDINARY);
    expect(getImpersonationToken()).toBeNull();
    expect(sessionStorage.getItem("janosik.impersonation")).toBeNull();
  });
});

/**
 * The claim is only a client-side filter: the server has the last word.
 * `/auth/me` names the impersonating master (`impersonatedBy`) only for a
 * verified view-as token — anything else drops the token and the tab boots
 * on its own session.
 */
describe("view-as boot confirmed by /auth/me (U-8)", () => {
  const viewed: AuthUserDto = {
    id: "user-9",
    email: "viewed@example.com",
    displayName: "Viewed",
    avatarColor: null,
    avatarPath: null,
    createdAt: 0,
  };
  const own: AuthUserDto = { ...viewed, id: "me", email: "me@example.com" };

  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  /** `/auth/me` answers `me`; `/auth/refresh` restores the tab's own session. */
  function stubServer(me: () => Response): string[] {
    const meTokens: string[] = [];
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), "http://api.test").pathname;
        if (path.endsWith("/auth/me")) {
          const headers = (init?.headers ?? {}) as Record<string, string>;
          meTokens.push(headers.Authorization ?? "");
          return me();
        }
        if (path.endsWith("/auth/refresh")) {
          return json({ accessToken: "own-session", user: own });
        }
        return json({ message: "Not found" }, 404);
      },
    );
    return meTokens;
  }

  function Probe() {
    const { status, user, impersonating } = useAuth();
    return createElement(
      "output",
      { "data-testid": "probe" },
      `${status}|${user?.id ?? "-"}|${impersonating === true ? "view-as" : "own"}`,
    );
  }

  function boot() {
    return render(createElement(AuthProvider, null, createElement(Probe)));
  }

  beforeEach(() => {
    vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
    sessionStorage.clear();
    api.setImpersonating(false);
    api.clearAccessToken();
    api.onAuthLost = null;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    api.setImpersonating(false);
    api.clearAccessToken();
    window.history.replaceState(null, "", "/");
    sessionStorage.clear();
  });

  it("enters the view-as session when the server names the master", async () => {
    const meTokens = stubServer(() =>
      json({ ...viewed, impersonatedBy: "master-1" }),
    );
    visit("/impersonate", IMPERSONATION);

    boot();
    await waitFor(() =>
      expect(screen.getByTestId("probe")).toHaveTextContent(
        "authenticated|user-9|view-as",
      ),
    );
    expect(meTokens).toEqual([`Bearer ${IMPERSONATION}`]);
    expect(api.getAccessToken()).toBe(IMPERSONATION);
    expect(getImpersonationToken()).toBe(IMPERSONATION);
  });

  it("drops a token the server does not confirm as view-as", async () => {
    // A forged `imp` claim on an otherwise valid token: the server answers
    // the profile but `impersonatedBy: null`.
    stubServer(() => json({ ...viewed, impersonatedBy: null }));
    visit("/impersonate", IMPERSONATION);

    boot();
    await waitFor(() =>
      expect(screen.getByTestId("probe")).toHaveTextContent(
        "authenticated|me|own",
      ),
    );
    expect(api.getAccessToken()).toBe("own-session");
    expect(api.isImpersonating()).toBe(false);
    expect(sessionStorage.getItem("janosik.impersonation")).toBeNull();
  });

  it("falls back to the tab's own session when /auth/me refuses the token", async () => {
    stubServer(() => json({ message: "Unauthorized" }, 401));
    visit("/impersonate", IMPERSONATION);

    boot();
    await waitFor(() =>
      expect(screen.getByTestId("probe")).toHaveTextContent(
        "authenticated|me|own",
      ),
    );
    expect(api.getAccessToken()).toBe("own-session");
    expect(sessionStorage.getItem("janosik.impersonation")).toBeNull();
  });
});
