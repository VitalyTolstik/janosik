import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { AuthUserDto } from "@janosik/shared";
import { api } from "@/api/client";
import { AuthProvider } from "@/auth/AuthContext";
import { LoginPage } from "@/components/auth/LoginPage";
import { I18nProvider } from "@/i18n";

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

function renderPage() {
  return render(
    <I18nProvider>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
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
});
