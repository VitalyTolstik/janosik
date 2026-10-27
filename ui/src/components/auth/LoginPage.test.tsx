import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { AuthUserDto } from "@janosik/shared";
import { api } from "@/api/client";
import { AuthProvider } from "@/auth/AuthContext";
import { LoginPage } from "@/components/auth/LoginPage";
import { I18nProvider } from "@/i18n";

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

function renderPage(initialEntries: string[] = ["/"]) {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>
    </I18nProvider>,
  );
}

function submit(email: string, password: string) {
  fireEvent.change(screen.getByTestId("login-email"), {
    target: { value: email },
  });
  fireEvent.change(screen.getByTestId("login-password"), {
    target: { value: password },
  });
  fireEvent.click(screen.getByTestId("login-submit"));
}

beforeEach(() => {
  // Server mode: the client talks to the stubbed fetch below.
  vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
  api.clearAccessToken();
  api.onAuthLost = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("LoginPage", () => {
  it("shows a localized error for wrong credentials", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      if (pathOf(input).endsWith("/auth/refresh")) {
        return json({ message: "Unauthorized" }, 401);
      }
      return json({ message: "Invalid credentials" }, 401);
    });

    renderPage();
    submit("admin@example.com", "wrong-password");
    const error = await screen.findByTestId("login-error");
    expect(error.textContent).not.toBe("");
    expect(api.getAccessToken()).toBeNull();
  });

  it("reports an unreachable server", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });

    renderPage();
    submit("admin@example.com", "password123");
    const error = await screen.findByTestId("login-error");
    expect(error.textContent).not.toBe("");
  });

  it("names the wait when the address is locked after failed sign-ins", async () => {
    let retryAfter = 42;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      if (pathOf(input).endsWith("/auth/login")) {
        return json(
          {
            message: "Too many failed sign-in attempts",
            code: "login_backoff",
            retryAfter,
          },
          429,
        );
      }
      return json({ message: "Unauthorized" }, 401);
    });

    renderPage();
    submit("admin@example.com", "wrong-password");
    expect(await screen.findByTestId("login-error")).toHaveTextContent(
      "Too many failed attempts — try again in 42 s",
    );

    retryAfter = 125;
    submit("admin@example.com", "wrong-password");
    await waitFor(() =>
      expect(screen.getByTestId("login-error")).toHaveTextContent(
        "Too many failed attempts — try again in 3 min",
      ),
    );
  });

  it("registers from the same screen and starts the session", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      if (pathOf(input).endsWith("/auth/refresh")) {
        return json({ message: "Unauthorized" }, 401);
      }
      return json({ accessToken: "access-1", user });
    });

    renderPage();
    fireEvent.click(screen.getByTestId("login-toggle"));
    expect(screen.getByTestId("login-display-name")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("login-display-name"), {
      target: { value: "Admin" },
    });
    submit("admin@example.com", "password123");
    await waitFor(() => expect(api.getAccessToken()).toBe("access-1"));
    expect(screen.queryByTestId("login-error")).toBeNull();
  });

  it("opens on the register form when the URL asks for it (?mode=register)", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      if (pathOf(input).endsWith("/auth/oauth/providers")) {
        return json({ providers: [] });
      }
      return json({ message: "Unauthorized" }, 401);
    });

    renderPage(["/?mode=register"]);
    expect(screen.getByTestId("login-display-name")).toBeInTheDocument();
  });

  it("hides the register form when the server closes sign-up (TASK-38a)", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      if (pathOf(input).endsWith("/auth/config")) {
        return json({ allowRegistration: false, allowPublicShares: true });
      }
      return json({ providers: [] });
    });

    renderPage();
    await waitFor(() =>
      expect(screen.queryByTestId("login-toggle")).toBeNull(),
    );
    expect(screen.queryByTestId("login-display-name")).toBeNull();
  });

  it("renders a start link for every enabled OAuth provider (TASK-54)", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      if (pathOf(input).endsWith("/auth/refresh")) {
        return json({ message: "Unauthorized" }, 401);
      }
      if (pathOf(input).endsWith("/auth/oauth/providers")) {
        return json({
          providers: [
            { id: "google", label: "Google" },
            { id: "yandex", label: "Яндекс" },
          ],
        });
      }
      throw new Error(`unexpected fetch: ${String(input)}`);
    });

    renderPage();
    const google = await screen.findByTestId("login-oauth-google");
    expect(google.closest("a")).toHaveAttribute(
      "href",
      "http://api.test/api/v1/auth/oauth/google/start",
    );
    expect(
      screen.getByTestId("login-oauth-yandex").closest("a"),
    ).toHaveAttribute("href", "http://api.test/api/v1/auth/oauth/yandex/start");
  });

  it("renders no OAuth buttons when no provider is enabled", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      if (pathOf(input).endsWith("/auth/oauth/providers")) {
        return json({ providers: [] });
      }
      return json({ message: "Unauthorized" }, 401);
    });

    renderPage();
    await waitFor(() =>
      expect(screen.queryByTestId("login-oauth-google")).toBeNull(),
    );
  });

  it("surfaces the OAuth failure returned via ?authError and clears it", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      if (pathOf(input).endsWith("/auth/oauth/providers")) {
        return json({ providers: [] });
      }
      return json({ message: "Unauthorized" }, 401);
    });

    renderPage(["/?authError=oauth_failed"]);
    const error = await screen.findByTestId("login-error");
    expect(error.textContent).not.toBe("");
  });
});
