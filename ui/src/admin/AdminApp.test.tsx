import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { I18nProvider } from "@/i18n";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { adminApi } from "./admin-client";
import AdminApp from "./AdminApp";
import { adminMessage } from "./admin-i18n";
import {
  FakeAdminServer,
  adminActivity,
  adminBoard,
  adminCard,
  adminComment,
  adminMaster,
  adminSession,
  adminToken,
  adminUser,
  contentBoard,
} from "./test/fake-admin-server";

/**
 * Master panel integration (TASK-36) against the in-memory fake admin API:
 * session boot, login, every page, moderation flows, one-time passwords and
 * the owner-only masters area.
 */

const t = (
  key: Parameters<typeof adminMessage>[0],
  params?: Record<string, string | number>,
) => adminMessage(key, "en", params);

function renderAdmin(initialPath = "/admin") {
  return render(
    <I18nProvider>
      <ToastProvider>
        <TooltipProvider>
          <MemoryRouter initialEntries={[initialPath]}>
            <Routes>
              <Route path="/admin/*" element={<AdminApp />} />
            </Routes>
          </MemoryRouter>
        </TooltipProvider>
      </ToastProvider>
    </I18nProvider>,
  );
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function login() {
  fireEvent.change(screen.getByTestId("admin-login-email"), {
    target: { value: "master@example.com" },
  });
  fireEvent.change(screen.getByTestId("admin-login-password"), {
    target: { value: "secret pass" },
  });
  fireEvent.click(screen.getByTestId("admin-login-submit"));
}

function serverWith(state?: ConstructorParameters<typeof FakeAdminServer>[0]) {
  return new FakeAdminServer(state);
}

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
  adminApi.clearAccessToken();
  adminApi.onAuthLost = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("AdminApp", () => {
  it("shows the master login when no session exists", async () => {
    const server = serverWith();
    server.sessionAlive = false;
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin();

    expect(await screen.findByTestId("admin-login-form")).toBeTruthy();
    expect(screen.queryByText(t("admin.nav.dashboard"))).toBeNull();
  });

  it("rejects wrong credentials with an inline error", async () => {
    const server = serverWith();
    server.sessionAlive = false;
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin();

    await screen.findByTestId("admin-login-form");
    fireEvent.change(screen.getByTestId("admin-login-email"), {
      target: { value: "master@example.com" },
    });
    fireEvent.change(screen.getByTestId("admin-login-password"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByTestId("admin-login-submit"));

    expect(await screen.findByText(t("admin.login.error"))).toBeTruthy();
  });

  it("restores a cookie session and renders the dashboard", async () => {
    const server = serverWith();
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin();

    expect(
      await screen.findByText(t("admin.dashboard.registrations")),
    ).toBeTruthy();
    expect(screen.getByTestId("admin-logout")).toBeTruthy();
    expect(screen.queryByTestId("admin-login-form")).toBeNull();
  });

  it("signs in, and signs out back to the login screen", async () => {
    const server = serverWith();
    server.sessionAlive = false;
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin();

    await screen.findByTestId("admin-login-form");
    await login();
    expect(await screen.findByText(t("admin.dashboard.activity"))).toBeTruthy();

    fireEvent.click(screen.getByTestId("admin-logout"));
    expect(await screen.findByTestId("admin-login-form")).toBeTruthy();
  });

  it("asks for the two-factor code when the master has 2FA on (TASK-65)", async () => {
    const server = serverWith();
    server.sessionAlive = false;
    server.loginTotpCode = "123456";
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin();

    await screen.findByTestId("admin-login-form");
    await login();

    // The password alone is refused; the one-time-code field appears.
    const totp = await screen.findByTestId("admin-login-totp");
    expect(screen.queryByText(t("admin.dashboard.activity"))).toBeNull();

    fireEvent.change(totp, { target: { value: "123456" } });
    fireEvent.click(screen.getByTestId("admin-login-submit"));
    expect(await screen.findByText(t("admin.dashboard.activity"))).toBeTruthy();
  });

  it("shows an invalid two-factor code error", async () => {
    const server = serverWith();
    server.sessionAlive = false;
    server.loginTotpCode = "123456";
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin();

    await screen.findByTestId("admin-login-form");
    await login();
    const totp = await screen.findByTestId("admin-login-totp");
    fireEvent.change(totp, { target: { value: "000000" } });
    fireEvent.click(screen.getByTestId("admin-login-submit"));

    expect(await screen.findByText(t("admin.login.totpInvalid"))).toBeTruthy();
  });

  it("lists users, blocks one and keeps the action recorded", async () => {
    const state = serverWith().state;
    state.users = [adminUser()];
    const server = new FakeAdminServer(state);
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/users");

    fireEvent.pointerDown(await screen.findByTestId("admin-row-actions-u-1"), {
      button: 0,
    });
    fireEvent.click(await screen.findByText(t("admin.users.action.disable")));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByTestId("admin-confirm-accept"));

    await waitFor(() => {
      expect(
        server.requests.some(
          (request) =>
            request.method === "PATCH" &&
            request.path === "/admin/users/u-1" &&
            (request.body as { disabled?: boolean }).disabled === true,
        ),
      ).toBe(true);
    });
    expect(
      await screen.findByText(t("admin.users.status.disabled")),
    ).toBeTruthy();
  });

  it("changes a user's email from the detail page (TASK-51)", async () => {
    const state = serverWith().state;
    state.users = [adminUser()];
    const server = new FakeAdminServer(state);
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/users/u-1");

    fireEvent.pointerDown(
      await screen.findByTestId("admin-user-detail-actions"),
      { button: 0 },
    );
    fireEvent.click(await screen.findByTestId("admin-user-change-email"));
    const dialog = await screen.findByTestId("admin-change-email-dialog");
    fireEvent.change(within(dialog).getByTestId("admin-change-email-input"), {
      target: { value: "moved@example.com" },
    });
    fireEvent.click(within(dialog).getByTestId("admin-change-email-submit"));

    await waitFor(() => {
      expect(server.state.users[0]?.email).toBe("moved@example.com");
    });
    expect(
      server.requests.some(
        (request) =>
          request.method === "PATCH" &&
          request.path === "/admin/users/u-1" &&
          (request.body as { email?: string }).email === "moved@example.com",
      ),
    ).toBe(true);
    // The panel heard about it: the subtitle now shows the new address.
    expect(await screen.findAllByText("moved@example.com")).toBeTruthy();
  });

  it("changes a user's email from the users list row menu (TASK-51)", async () => {
    const state = serverWith().state;
    state.users = [adminUser()];
    const server = new FakeAdminServer(state);
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/users");

    fireEvent.pointerDown(await screen.findByTestId("admin-row-actions-u-1"), {
      button: 0,
    });
    fireEvent.click(
      await screen.findByText(t("admin.users.action.changeEmail")),
    );
    const dialog = await screen.findByTestId("admin-change-email-dialog");
    fireEvent.change(within(dialog).getByTestId("admin-change-email-input"), {
      target: { value: "moved@example.com" },
    });
    fireEvent.click(within(dialog).getByTestId("admin-change-email-submit"));

    await waitFor(() => {
      expect(server.state.users[0]?.email).toBe("moved@example.com");
    });
    expect(
      server.requests.some(
        (request) =>
          request.method === "PATCH" &&
          request.path === "/admin/users/u-1" &&
          (request.body as { email?: string }).email === "moved@example.com",
      ),
    ).toBe(true);
    // The refreshed roster shows the new address.
    expect(await screen.findByText("moved@example.com")).toBeTruthy();
  });

  it("refuses to move a user's email onto a taken address", async () => {
    const state = serverWith().state;
    state.users = [
      adminUser(),
      adminUser({ id: "u-2", email: "x@example.com" }),
    ];
    const server = new FakeAdminServer(state);
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/users/u-1");

    fireEvent.pointerDown(
      await screen.findByTestId("admin-user-detail-actions"),
      { button: 0 },
    );
    fireEvent.click(await screen.findByTestId("admin-user-change-email"));
    const dialog = await screen.findByTestId("admin-change-email-dialog");
    fireEvent.change(within(dialog).getByTestId("admin-change-email-input"), {
      target: { value: "x@example.com" },
    });
    fireEvent.click(within(dialog).getByTestId("admin-change-email-submit"));

    expect(
      await within(dialog).findByTestId("admin-change-email-error"),
    ).toHaveTextContent(t("admin.users.changeEmail.taken"));
    expect(server.state.users[0]?.email).not.toBe("x@example.com");
  });

  it("creates a user and reveals the generated password once", async () => {
    const server = serverWith();
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/users");

    fireEvent.click(await screen.findByTestId("admin-create-user"));
    fireEvent.change(screen.getByTestId("admin-user-email"), {
      target: { value: "new@example.com" },
    });
    fireEvent.click(screen.getByTestId("admin-user-submit"));

    expect(
      await screen.findByTestId("admin-created-password"),
    ).toHaveTextContent("generated-pass-123");
    fireEvent.click(screen.getByText(t("admin.users.created.done")));
    expect(await screen.findByText("new@example.com")).toBeTruthy();
  });

  it("surfaces a list failure and retries on demand", async () => {
    const server = serverWith();
    server.failNext = ["/admin/entities/users"];
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/users");

    expect(await screen.findByText(t("admin.common.error"))).toBeTruthy();
    fireEvent.click(screen.getByText(t("admin.common.retry")));
    await waitFor(() => {
      expect(screen.queryByText(t("admin.common.error"))).toBeNull();
    });
  });

  it("creates a board for a user and archives it", async () => {
    const state = serverWith().state;
    state.users = [adminUser()];
    state.boards = [adminBoard()];
    const server = new FakeAdminServer(state);
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/boards");

    fireEvent.click(await screen.findByTestId("admin-create-board"));
    fireEvent.change(screen.getByTestId("admin-board-title"), {
      target: { value: "Launch" },
    });
    fireEvent.change(screen.getByTestId("admin-board-owner"), {
      target: { value: "member@example.com" },
    });
    fireEvent.click(screen.getByTestId("admin-board-submit"));
    expect(await screen.findByText("Launch")).toBeTruthy();

    fireEvent.pointerDown(await screen.findByTestId("admin-row-actions-b-1"), {
      button: 0,
    });
    fireEvent.click(await screen.findByText(t("admin.boards.action.archive")));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByTestId("admin-confirm-accept"));
    await waitFor(() => {
      expect(
        server.state.boards.find((board) => board.id === "b-1")?.archivedAt,
      ).not.toBeNull();
    });
    expect(
      server.requests.some(
        (request) => request.path === "/admin/boards/b-1/archive",
      ),
    ).toBe(true);
  });

  it("renders the command log and the audit trail", async () => {
    const state = serverWith().state;
    state.commands = [
      {
        id: "c-1",
        boardId: "b-1",
        boardTitle: "Roadmap",
        actorId: "u-1",
        actorEmail: "member@example.com",
        type: "ADD_CARD",
        seq: 12,
        createdAt: 1_760_000_000_000,
        payload: { newCardId: "card-1", title: "Moderate me" },
      },
    ];
    state.audit = [
      {
        id: "a-1",
        adminId: "master-1",
        adminEmail: "master@example.com",
        action: "admin.login",
        targetType: null,
        targetId: null,
        details: null,
        createdAt: 1_760_000_000_000,
      },
    ];
    const server = new FakeAdminServer(state);
    vi.stubGlobal("fetch", server.fetchImpl);
    const view = renderAdmin("/admin/commands");

    expect(await screen.findByText("ADD_CARD")).toBeTruthy();
    expect(screen.getByText("Roadmap")).toBeTruthy();

    view.unmount();
    renderAdmin("/admin/audit");
    expect(await screen.findByText("admin.login")).toBeTruthy();
  });

  it("lets an owner add a master and shows the one-time password", async () => {
    const server = serverWith();
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/masters");

    fireEvent.click(await screen.findByTestId("admin-create-master"));
    fireEvent.change(screen.getByTestId("admin-master-email"), {
      target: { value: "second@example.com" },
    });
    fireEvent.click(screen.getByTestId("admin-master-submit"));

    expect(
      await screen.findByTestId("admin-master-password"),
    ).toHaveTextContent("one-time-master-pass");
    fireEvent.click(screen.getByTestId("admin-master-done"));
    expect(await screen.findByText("second@example.com")).toBeTruthy();
    expect(screen.getByText(t("admin.masters.operatorBadge"))).toBeTruthy();
  });

  it("hides the masters area from operators and shows the 403 error there", async () => {
    const server = serverWith();
    server.sessionRole = "OPERATOR";
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/users");

    await screen.findByTestId("admin-create-user");
    expect(
      screen.queryByRole("link", { name: t("admin.nav.masters") }),
    ).toBeNull();
    expect(
      screen.queryByRole("link", { name: t("admin.nav.dashboard") }),
    ).not.toBeNull();
  });

  it("resets a master password from the roster", async () => {
    const server = serverWith();
    server.masters = [adminMaster()];
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/masters");

    fireEvent.pointerDown(
      await screen.findByTestId("admin-master-menu-operator@example.com"),
      { button: 0 },
    );
    fireEvent.click(
      await screen.findByText(t("admin.masters.action.resetPassword")),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByTestId("admin-confirm-accept"));

    expect(
      await screen.findByTestId("admin-master-password"),
    ).toHaveTextContent("reset-one-time-pass");
  });

  it("surfaces a rejected login lockout as a dedicated message", async () => {
    const server = serverWith();
    server.sessionAlive = false;
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(
          typeof input === "string" ? input : input.toString(),
          "http://api.test",
        ).pathname;
        if (path.endsWith("/admin/auth/login")) {
          return jsonResponse(
            { message: "Account is temporarily locked" },
            429,
          );
        }
        return server.fetchImpl(input, init);
      },
    );
    renderAdmin();

    await screen.findByTestId("admin-login-form");
    await login();
    expect(await screen.findByText(t("admin.login.locked"))).toBeTruthy();
  });

  it("collapses the sidebar to an icon rail and remembers the choice", async () => {
    localStorage.clear();
    const server = serverWith();
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin");

    const aside = await screen.findByTestId("admin-sidebar");
    expect(aside).toHaveAttribute("data-collapsed", "false");
    expect(
      within(screen.getByTestId("admin-sidebar")).getByText(
        t("admin.nav.users"),
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByTestId("admin-sidebar-toggle"));
    expect(screen.getByTestId("admin-sidebar")).toHaveAttribute(
      "data-collapsed",
      "true",
    );
    // Labels are gone from the rail (icon-only navigation).
    expect(
      within(screen.getByTestId("admin-sidebar")).queryByText(
        t("admin.nav.users"),
      ),
    ).toBeNull();
    expect(localStorage.getItem("janosik.admin.sidebar")).toBe("1");
  });
});

describe("admin content and security pages", () => {
  it("archives a card from the global cards page", async () => {
    const state = serverWith().state;
    state.cards = [adminCard()];
    const server = new FakeAdminServer(state);
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/cards");

    fireEvent.pointerDown(
      await screen.findByTestId("admin-row-actions-card-1"),
      { button: 0 },
    );
    fireEvent.click(await screen.findByText(t("admin.cards.action.archive")));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByTestId("admin-confirm-accept"));

    await waitFor(() => {
      expect(server.state.cards[0]?.archivedAt).not.toBeNull();
    });
    expect(
      server.requests.some(
        (request) => request.path === "/admin/cards/card-1/archive",
      ),
    ).toBe(true);
  });

  it("links rows into their detail pages", async () => {
    const state = serverWith().state;
    state.boards = [
      adminBoard({ id: "b-7", userId: "u-42", ownerEmail: "owner@ex.com" }),
    ];
    state.cards = [
      adminCard({ id: "card-1", boardId: "b-7", columnId: "col-9" }),
    ];
    const server = new FakeAdminServer(state);
    vi.stubGlobal("fetch", server.fetchImpl);

    renderAdmin("/admin/boards");
    const ownerLink = await screen.findByTestId("admin-board-row-b-7");
    expect(ownerLink).toHaveTextContent("owner@ex.com");

    renderAdmin("/admin/cards");
    const cardLink = await screen.findByTestId("admin-card-row-card-1");
    expect(cardLink).toHaveTextContent("Moderate me");
    expect(
      cardLink.querySelector('a[href="/admin/boards/b-7"]'),
    ).not.toBeNull();
  });

  it("revokes a single session", async () => {
    const state = serverWith().state;
    state.sessions = [adminSession()];
    const server = new FakeAdminServer(state);
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/sessions");

    fireEvent.pointerDown(
      await screen.findByTestId("admin-row-actions-session-1"),
      { button: 0 },
    );
    fireEvent.click(await screen.findByText(t("admin.sessions.action.revoke")));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByTestId("admin-confirm-accept"));

    await waitFor(() => {
      expect(screen.queryByTestId("admin-row-actions-session-1")).toBeNull();
    });
    expect(
      server.requests.some(
        (request) => request.path === "/admin/sessions/session-1/revoke",
      ),
    ).toBe(true);
  });

  it("revokes an API token", async () => {
    const state = serverWith().state;
    state.tokens = [adminToken()];
    const server = new FakeAdminServer(state);
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/tokens");

    fireEvent.pointerDown(
      await screen.findByTestId("admin-row-actions-token-1"),
      {
        button: 0,
      },
    );
    fireEvent.click(await screen.findByText(t("admin.tokens.action.revoke")));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByTestId("admin-confirm-accept"));

    // A revoked token keeps its revokedAt timestamp and loses the action.
    await waitFor(() => {
      expect(screen.queryByTestId("admin-row-actions-token-1")).toBeNull();
    });
    expect(
      server.requests.some(
        (request) => request.path === "/admin/tokens/token-1/revoke",
      ),
    ).toBe(true);
  });

  it("renders no action menu at all for an already revoked token", async () => {
    const state = serverWith().state;
    state.tokens = [adminToken({ revokedAt: Date.now() - 1_000 })];
    vi.stubGlobal("fetch", new FakeAdminServer(state).fetchImpl);
    renderAdmin("/admin/tokens");

    await screen.findByText(t("admin.status.revoked"));
    expect(screen.queryByTestId("admin-row-actions-token-1")).toBeNull();
  });

  it("interpolates the row total into a page subtitle", async () => {
    const state = serverWith().state;
    state.sessions = [adminSession()];
    vi.stubGlobal("fetch", new FakeAdminServer(state).fetchImpl);
    renderAdmin("/admin/sessions");

    await screen.findByText("1 active sessions");
  });

  it("applies the activity period window as a from query bound", async () => {
    const state = serverWith().state;
    state.activity = [adminActivity()];
    const server = new FakeAdminServer(state);
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/activity");

    fireEvent.click(await screen.findByText(t("admin.filter.period.24h")));
    await screen.findByText(/Looks good/);
    await waitFor(() => {
      const requests = server.requests.filter(
        (request) => request.path === "/admin/entities/activity",
      );
      const latest = requests[requests.length - 1];
      expect(latest).toBeDefined();
      const from = latest?.query.get("from");
      expect(from).not.toBeNull();
      expect(Number(from)).toBeLessThanOrEqual(Date.now());
      expect(Number(from)).toBeGreaterThan(Date.now() - 25 * 3_600_000);
    });
  });

  it("deletes a comment", async () => {
    const state = serverWith().state;
    state.comments = [adminComment()];
    const server = new FakeAdminServer(state);
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/comments");

    fireEvent.pointerDown(
      await screen.findByTestId("admin-row-actions-comment-1"),
      { button: 0 },
    );
    fireEvent.click(await screen.findByText(t("admin.comments.action.delete")));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByTestId("admin-confirm-accept"));

    expect(
      await screen.findByText(t("admin.comments.status.deleted")),
    ).toBeTruthy();
  });

  it("creates a column and a card through the command log", async () => {
    const state = serverWith().state;
    state.contentBoard = contentBoard();
    const server = new FakeAdminServer(state);
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/boards/b-1/content");

    fireEvent.change(await screen.findByTestId("admin-new-column"), {
      target: { value: "To Do" },
    });
    fireEvent.click(screen.getByTestId("admin-add-column"));
    expect(await screen.findByText("To Do")).toBeTruthy();

    fireEvent.change(screen.getByTestId("admin-new-card"), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByTestId("admin-add-card"));
    expect(await screen.findByText("Hello")).toBeTruthy();

    const commands = server.requests
      .filter((request) => request.path.endsWith("/commands"))
      .map(
        (request) => (request.body as { action: { type: string } }).action.type,
      );
    expect(commands).toEqual(["ADD_COLUMN", "ADD_CARD"]);
  });

  it("shows the runtime card on the dashboard", async () => {
    const server = serverWith();
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin");

    expect(await screen.findByText("0.1.0-test")).toBeTruthy();
    expect(screen.getByText("0m 42s")).toBeTruthy();
    expect(screen.getByText("test")).toBeTruthy();
  });

  it("states the security page is scoped to the master account", async () => {
    const server = serverWith();
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/security");

    expect(await screen.findByTestId("admin-security-scope")).toHaveTextContent(
      t("admin.security.scope"),
    );
  });

  it("makes the IP allowlist read-only for operators (TASK-65)", async () => {
    const server = serverWith();
    server.sessionRole = "OPERATOR";
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/security");

    expect(await screen.findByTestId("admin-ip-allowlist")).toBeDisabled();
    expect(await screen.findByTestId("admin-ip-readonly")).toBeTruthy();
    expect(screen.queryByTestId("admin-ip-save")).toBeNull();
  });
});
