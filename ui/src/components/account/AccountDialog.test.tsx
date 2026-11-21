import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/api/client";
import { AuthProvider } from "@/auth/AuthContext";
import { AccountDialog } from "@/components/account/AccountDialog";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { ThemeProvider } from "@/hooks/use-theme";
import { I18nProvider } from "@/i18n";
import { FakeServer } from "@/test/fake-server";

/**
 * Account panel (TASK-36.1): the header trigger replaces the old sign-out
 * button; the dialog hosts the profile, security, API-key and preference
 * sections, and sign-out moved to the rail behind the usual confirmation.
 */

function renderAccount(
  server: FakeServer,
  handler: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response> = server.handle,
  entry = "/",
) {
  vi.stubGlobal("fetch", handler);
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <I18nProvider>
          <TooltipProvider>
            <ToastProvider>
              <AuthProvider>
                <MemoryRouter initialEntries={[entry]}>
                  <AccountDialog />
                </MemoryRouter>
              </AuthProvider>
            </ToastProvider>
          </TooltipProvider>
        </I18nProvider>
      </BoardBackgroundProvider>
    </ThemeProvider>,
  );
}

async function openPanel(server: FakeServer) {
  renderAccount(server);
  const trigger = await screen.findByTestId("account-trigger");
  await userEvent.click(trigger);
  return await screen.findByTestId("account-dialog");
}

describe("AccountDialog (TASK-36.1)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
    api.clearAccessToken();
    api.onAuthLost = null;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("stays hidden without a session", async () => {
    const server = new FakeServer();
    server.refreshValid = false;

    renderAccount(server);

    await waitFor(() =>
      expect(
        server.requests.some((r) => r.path === "/api/v1/auth/refresh"),
      ).toBe(true),
    );
    expect(screen.queryByTestId("account-trigger")).toBeNull();
  });

  it("shows who is signed in and opens on the profile section", async () => {
    const server = new FakeServer();

    const panel = await openPanel(server);

    expect(within(panel).getByText("Admin")).toBeInTheDocument();
    expect(within(panel).getByText("admin@example.com")).toBeInTheDocument();
    expect(screen.getByTestId("account-profile")).toBeInTheDocument();
    expect(screen.getByText(/With Janosik since/)).toBeInTheDocument();
  });

  it("saves the display name and avatar color and updates the header", async () => {
    const server = new FakeServer();
    await openPanel(server);

    const name = screen.getByTestId("account-display-name");
    await userEvent.clear(name);
    await userEvent.type(name, "Vera");
    await userEvent.click(screen.getByTestId("avatar-color-teal"));
    await userEvent.click(screen.getByTestId("account-profile-save"));

    await waitFor(() =>
      expect(server.requests).toContainEqual({
        method: "PATCH",
        path: "/api/v1/users/me",
        body: { displayName: "Vera", avatarColor: "teal", notifyDigest: true },
      }),
    );
    expect(server.account.displayName).toBe("Vera");
    expect(server.account.avatarColor).toBe("teal");

    // The header trigger is part of the same auth state: new name, new color.
    const trigger = screen.getByTestId("account-trigger");
    await waitFor(() => expect(trigger).toHaveTextContent("Vera"));
    expect(trigger.querySelector("[data-testid='user-avatar']")).toHaveClass(
      "bg-teal",
    );
  });

  it("saves the immediate attention email opt-out through the dedicated endpoint", async () => {
    const server = new FakeServer();
    await openPanel(server);
    const attention = screen.getByTestId("account-notify-attention");
    expect(attention).toBeChecked();

    await userEvent.click(attention);
    await userEvent.click(screen.getByTestId("account-profile-save"));

    await waitFor(() => expect(server.account.notifyAttention).toBe(false));
    expect(server.requests).toContainEqual({
      method: "PATCH",
      path: "/api/v1/users/me/notification-settings",
      body: { notifyAttention: false },
    });
    // The attention switch must not ride along in the profile write.
    expect(
      server.requests.some(
        (request) =>
          request.method === "PATCH" &&
          request.path === "/api/v1/users/me" &&
          Object.prototype.hasOwnProperty.call(
            (request.body ?? {}) as Record<string, unknown>,
            "notifyAttention",
          ),
      ),
    ).toBe(false);
    expect(attention).not.toBeChecked();
  });

  it("loads the attention opt-out from the session", async () => {
    const server = new FakeServer();
    server.account.notifyAttention = false;
    await openPanel(server);

    expect(screen.getByTestId("account-notify-attention")).not.toBeChecked();
  });

  it("reverts the attention switch when the server refuses the save", async () => {
    const server = new FakeServer();
    renderAccount(server, async (input, init) => {
      const url = new URL(String(input), "http://api.test");
      if (url.pathname === "/api/v1/users/me/notification-settings") {
        return Response.json({ message: "Unavailable" }, { status: 503 });
      }
      return server.handle(input, init);
    });
    await userEvent.click(await screen.findByTestId("account-trigger"));
    const attention = await screen.findByTestId("account-notify-attention");
    expect(attention).toBeChecked();

    await userEvent.click(attention);
    expect(attention).not.toBeChecked();
    await userEvent.click(screen.getByTestId("account-profile-save"));

    expect(await screen.findByText("Could not save the profile")).toBeVisible();
    await waitFor(() => expect(attention).toBeChecked());
    expect(server.account.notifyAttention).toBe(true);
  });

  it("opens the panel on the section named by an account deep link", async () => {
    const server = new FakeServer();
    renderAccount(server, server.handle, "/board/b-1?account=tokens");

    expect(await screen.findByTestId("account-dialog")).toBeVisible();
    expect(await screen.findByTestId("account-tokens")).toBeVisible();
  });

  it("switches between the sections without closing", async () => {
    const server = new FakeServer();
    await openPanel(server);

    await userEvent.click(screen.getByTestId("account-nav-tokens"));
    expect(screen.getByTestId("account-tokens")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("account-nav-preferences"));
    expect(screen.getByTestId("account-preferences")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("account-nav-security"));
    expect(screen.getByTestId("account-security")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("account-nav-profile"));
    expect(screen.getByTestId("account-profile")).toBeInTheDocument();
  });

  it("signs out only after the confirmation", async () => {
    const server = new FakeServer();
    await openPanel(server);

    await userEvent.click(screen.getByTestId("account-logout"));

    const confirm = await screen.findByRole("dialog", { name: "Sign out?" });
    expect(confirm).toHaveTextContent("admin@example.com");
    expect(server.requests.some((r) => r.path === "/api/v1/auth/logout")).toBe(
      false,
    );

    await userEvent.click(
      within(confirm).getByRole("button", { name: "Sign out" }),
    );

    await waitFor(() =>
      expect(server.requests).toContainEqual({
        method: "POST",
        path: "/api/v1/auth/logout",
        body: {},
      }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("account-trigger")).toBeNull(),
    );
  });
});
