import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { AuthUserDto } from "@janosik/shared";
import { api } from "@/api/client";
import { AuthProvider } from "@/auth/AuthContext";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n";

/**
 * The board header must offer sign-out in plain sight (the regression this
 * component fixes): the control shows up only for a live server session,
 * carries a visible label, and ends the session in one click.
 */

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

function renderButton() {
  return render(
    <I18nProvider>
      <TooltipProvider>
        <AuthProvider>
          <SignOutButton />
        </AuthProvider>
      </TooltipProvider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
  api.clearAccessToken();
  api.onAuthLost = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("SignOutButton", () => {
  it("stays hidden without a session", async () => {
    vi.stubGlobal("fetch", async () => json({ message: "Unauthorized" }, 401));

    renderButton();
    await waitFor(() => expect(api.onAuthLost).not.toBeNull());
    expect(screen.queryByTestId("account-logout")).toBeNull();
  });

  it("says what it does and ends the session in one click", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const path = pathOf(input);
      calls.push(path);
      if (path.endsWith("/auth/refresh")) {
        return json({ accessToken: "access-1", user });
      }
      return json({ status: "ok" });
    });

    renderButton();
    const button = await screen.findByTestId("account-logout");
    expect(button.textContent).toContain("Sign out");

    await userEvent.click(button);
    await waitFor(() => expect(calls).toContain("/api/v1/auth/logout"));
    await waitFor(() =>
      expect(screen.queryByTestId("account-logout")).toBeNull(),
    );
    expect(api.getAccessToken()).toBeNull();
  });
});
