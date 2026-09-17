import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { AuthUserDto } from "@janosik/shared";
import { api } from "@/api/client";
import { AuthProvider } from "@/auth/AuthContext";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n";

/**
 * The board header must offer sign-out without digging into the data menu
 * (the regression this component fixes): the trigger shows up only for a
 * live server session and the action revokes it.
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

function renderMenu() {
  return render(
    <I18nProvider>
      <TooltipProvider>
        <AuthProvider>
          <AccountMenu />
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

describe("AccountMenu", () => {
  it("stays hidden without a session", async () => {
    vi.stubGlobal("fetch", async () => json({ message: "Unauthorized" }, 401));

    renderMenu();
    await waitFor(() => expect(api.onAuthLost).not.toBeNull());
    expect(screen.queryByTestId("account-menu")).toBeNull();
  });

  it("shows the signed-in email and signs out in one click", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const path = pathOf(input);
      calls.push(path);
      if (path.endsWith("/auth/refresh")) {
        return json({ accessToken: "access-1", user });
      }
      return json({ status: "ok" });
    });

    renderMenu();
    const trigger = await screen.findByTestId("account-menu");
    await userEvent.click(trigger);

    expect(
      await screen.findByText("Signed in as admin@example.com"),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("account-logout"));
    await waitFor(() => expect(calls).toContain("/api/v1/auth/logout"));
    await waitFor(() =>
      expect(screen.queryByTestId("account-menu")).toBeNull(),
    );
    expect(api.getAccessToken()).toBeNull();
  });
});
