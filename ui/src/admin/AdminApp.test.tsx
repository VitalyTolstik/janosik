import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
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
import { ThemeProvider } from "@/hooks/use-theme";
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
  // Mirrors the real tree in `App.tsx`: the master panel lives inside the
  // app-wide `ThemeProvider`, so the top-bar theme toggle works here too.
  return render(
    <ThemeProvider>
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
      </I18nProvider>
    </ThemeProvider>,
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
  it("lets the owner edit another master's IP access", async () => {
    const server = serverWith();
    server.masters = [adminMaster()];
    server.masterAllowlists["master-2"] = "192.0.2.10";
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/masters");

    fireEvent.pointerDown(
      await screen.findByTestId("admin-master-menu-operator@example.com"),
      { button: 0 },
    );
    fireEvent.click(
      await screen.findByText(t("admin.masters.action.allowlist")),
    );
    const input = await screen.findByRole("textbox", {
      name: t("admin.masters.action.allowlist"),
    });
    await waitFor(() => expect(input).toHaveValue("192.0.2.10"));
    fireEvent.change(input, { target: { value: "10.0.0.0/8" } });
    fireEvent.click(
      screen.getByRole("button", { name: t("admin.common.save") }),
    );
    await waitFor(() =>
      expect(server.masterAllowlists["master-2"]).toBe("10.0.0.0/8"),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
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

  it("explains when a valid master login is denied by IP restriction", async () => {
    const server = serverWith();
    server.sessionAlive = false;
    server.loginIpDenied = true;
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin();
    await screen.findByTestId("admin-login-form");
    await login();
    expect(await screen.findByText(t("admin.login.ipDenied"))).toBeTruthy();
    expect(screen.getByText(t("admin.login.ipDeniedHint"))).toBeTruthy();
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

  it("retries a throttled refresh instead of signing the master out (QA-A3)", async () => {
    const server = serverWith();
    server.failNextStatuses.push({
      path: "/admin/auth/refresh",
      status: 429,
      body: { message: "ThrottlerException: Too Many Requests" },
    });
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin();

    // The boot screen says it is retrying; the sign-in form must not appear.
    expect(await screen.findByTestId("admin-boot-recovering")).toBeTruthy();
    expect(screen.queryByTestId("admin-login-form")).toBeNull();

    expect(
      await screen.findByText(
        t("admin.dashboard.registrations"),
        {},
        { timeout: 4000 },
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId("admin-login-form")).toBeNull();
  });

  it.each([429, 500])(
    "bounds boot refresh retries and offers retry and sign-in (%i)",
    async (status) => {
      const server = serverWith();
      let refreshCalls = 0;
      vi.stubGlobal(
        "fetch",
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const path = new URL(
            typeof input === "string" ? input : input.toString(),
            "http://api.test",
          ).pathname;
          if (path.endsWith("/admin/auth/refresh")) {
            refreshCalls += 1;
            return jsonResponse({ message: "down" }, status);
          }
          return server.fetchImpl(input, init);
        },
      );
      vi.useFakeTimers({ toFake: ["setTimeout"] });
      try {
        renderAdmin();
        await act(async () => {
          await Promise.resolve();
        });
        for (const delay of [1000, 2000, 4000]) {
          await act(async () => {
            await vi.advanceTimersByTimeAsync(delay);
          });
        }
        expect(refreshCalls).toBe(4);
        expect(screen.getByTestId("admin-boot-failed")).toBeInTheDocument();
        expect(
          screen.queryByTestId("admin-login-form"),
        ).not.toBeInTheDocument();

        fireEvent.click(
          screen.getByRole("button", { name: t("admin.common.retry") }),
        );
        await act(async () => {
          await Promise.resolve();
        });
        expect(refreshCalls).toBe(5);
        expect(screen.getByTestId("admin-boot-recovering")).toBeInTheDocument();
        for (const delay of [1000, 2000, 4000]) {
          await act(async () => {
            await vi.advanceTimersByTimeAsync(delay);
          });
        }
        expect(screen.getByTestId("admin-boot-failed")).toBeInTheDocument();

        fireEvent.click(
          screen.getByRole("button", { name: t("admin.boot.signIn") }),
        );
        await act(async () => {
          await Promise.resolve();
        });
        expect(screen.getByTestId("admin-login-form")).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("times out a hung create-master request and re-enables Cancel", async () => {
    const server = serverWith();
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/masters");

    fireEvent.click(await screen.findByTestId("admin-create-master"));
    fireEvent.change(await screen.findByTestId("admin-master-email"), {
      target: { value: "timeout-master@example.com" },
    });
    const dialog = await screen.findByRole("dialog");
    const cancel = within(dialog).getByRole("button", {
      name: t("admin.common.cancel"),
    });
    server.holds.push({
      match: "/admin/admins",
      promise: new Promise<void>(() => {
        /* held forever */
      }),
    });
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      fireEvent.click(within(dialog).getByTestId("admin-master-submit"));
      await act(async () => {
        await Promise.resolve();
      });
      expect(cancel).toBeDisabled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(
        within(dialog).getByText(t("admin.masters.create.timeout")),
      ).toBeInTheDocument();
      expect(cancel).not.toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out a hung promote request and re-enables Cancel", async () => {
    const state = serverWith().state;
    state.users = [adminUser()];
    const server = new FakeAdminServer(state);
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/users/u-1");

    fireEvent.pointerDown(
      await screen.findByTestId("admin-user-detail-actions"),
      { button: 0 },
    );
    fireEvent.click(await screen.findByTestId("admin-user-promote"));
    const dialog = await screen.findByTestId("admin-promote-user-dialog");
    fireEvent.change(within(dialog).getByTestId("admin-promote-user-input"), {
      target: { value: "member@example.com" },
    });
    const cancel = within(dialog).getByRole("button", {
      name: t("admin.common.cancel"),
    });
    server.holds.push({
      match: "/admin/users/u-1/promote",
      promise: new Promise<void>(() => {
        /* held forever */
      }),
    });
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      fireEvent.click(within(dialog).getByTestId("admin-promote-user-submit"));
      await act(async () => {
        await Promise.resolve();
      });
      expect(cancel).toBeDisabled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(
        within(dialog).getByText(t("admin.userDetail.promote.timeout")),
      ).toBeInTheDocument();
      expect(cancel).not.toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out a hung boot refresh and maps it to unavailable", async () => {
    const server = serverWith();
    let refreshCalls = 0;
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(
          typeof input === "string" ? input : input.toString(),
          "http://api.test",
        ).pathname;
        if (path.endsWith("/admin/auth/refresh")) {
          refreshCalls += 1;
          return new Promise<Response>((_, reject) => {
            const abort = () =>
              reject(new DOMException("aborted", "AbortError"));
            if (init?.signal?.aborted === true) abort();
            else init?.signal?.addEventListener("abort", abort, { once: true });
          });
        }
        return server.fetchImpl(input, init);
      },
    );
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      renderAdmin();
      await act(async () => {
        await Promise.resolve();
      });
      for (const [timeout, backoff] of [
        [15_000, 1_000],
        [15_000, 2_000],
        [15_000, 4_000],
        [15_000, 0],
      ]) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(timeout);
        });
        if (backoff > 0) {
          await act(async () => {
            await vi.advanceTimersByTimeAsync(backoff);
          });
        }
      }
      expect(refreshCalls).toBe(4);
      expect(screen.getByTestId("admin-boot-failed")).toHaveTextContent(
        t("admin.boot.failed.unavailable"),
      );
    } finally {
      vi.useRealTimers();
    }
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

  it("explains the public snapshot exception before deleting a user", async () => {
    const state = serverWith().state;
    state.users = [adminUser()];
    const server = new FakeAdminServer(state);
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/users/u-1");

    const notice =
      "Copies already published in board snapshots can remain public.";
    const policy = t("admin.userDetail.delete.securityPolicy");
    expect(await screen.findByText(notice, { exact: false })).toBeVisible();
    expect(screen.getByRole("link", { name: policy })).toHaveAttribute(
      "href",
      "/docs/security/",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: t("admin.userDetail.action.deleteUser"),
      }),
    );
    const dialog = await screen.findByTestId("admin-delete-user-dialog");
    expect(within(dialog).getByText(notice, { exact: false })).toBeVisible();
    expect(within(dialog).getByRole("link", { name: policy })).toHaveAttribute(
      "href",
      "/docs/security/",
    );
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

  it("times out a hung create-user request and releases the dialog", async () => {
    const server = serverWith();
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/users");

    fireEvent.click(await screen.findByTestId("admin-create-user"));
    fireEvent.change(await screen.findByTestId("admin-user-email"), {
      target: { value: "timeout-user@example.com" },
    });
    const dialog = await screen.findByRole("dialog");
    const cancel = within(dialog).getByRole("button", {
      name: t("admin.common.cancel"),
    });
    server.holds.push({
      match: "/admin/users",
      promise: new Promise<void>(() => {
        /* held forever */
      }),
    });
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      fireEvent.click(within(dialog).getByTestId("admin-user-submit"));
      await act(async () => {
        await Promise.resolve();
      });
      expect(cancel).toBeDisabled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(
        within(dialog).getByText(t("admin.users.create.timeout")),
      ).toBeInTheDocument();
      expect(cancel).not.toBeDisabled();
      fireEvent.click(cancel);
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("validates the create-user email before submitting", async () => {
    const server = serverWith();
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/users");

    fireEvent.click(await screen.findByTestId("admin-create-user"));
    fireEvent.change(screen.getByTestId("admin-user-email"), {
      target: { value: "not-an-email" },
    });
    expect(await screen.findByText(t("admin.validation.email"))).toBeTruthy();
    expect(screen.getByTestId("admin-user-submit")).toBeDisabled();
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
        auditId: "audit-1",
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
        targetExists: null,
        details: null,
        createdAt: 1_760_000_000_000,
      },
    ];
    const server = new FakeAdminServer(state);
    vi.stubGlobal("fetch", server.fetchImpl);
    const view = renderAdmin("/admin/commands");

    expect(await screen.findByText("ADD_CARD")).toBeTruthy();
    expect(screen.getByText("Roadmap")).toBeTruthy();
    const auditLink = screen.getByTestId("admin-command-audit-c-1");
    const auditUrl = new URL(
      auditLink.getAttribute("href") ?? "",
      "http://admin.test",
    );
    expect(auditUrl.pathname).toBe("/admin/audit");
    expect(auditUrl.searchParams.get("tab")).toBe("audit");
    // The filter is the command id; `auditId` is only the "correlated" flag.
    expect(auditUrl.searchParams.get("commandId")).toBe("c-1");
    expect(auditUrl.searchParams.get("returnTo")).toBe(
      "/admin/audit?tab=commands",
    );
    expect(auditLink).toHaveAccessibleName("Audit command c-1 (ADD_CARD)");

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
      screen.queryByRole("link", { name: t("admin.hub.overview") }),
    ).not.toBeNull();
  });

  it("purges with the visible retention draft, once, and counts with it (QA-A1/A7)", async () => {
    const server = serverWith();
    server.ops.retentionDays = 30;
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/settings?tab=general");

    const input = await screen.findByTestId("admin-ops-retention");
    fireEvent.change(input, { target: { value: "365" } });
    expect(await screen.findByTestId("admin-ops-retention-dirty")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId("admin-ops-purge")).not.toBeDisabled(),
    );

    fireEvent.click(screen.getByTestId("admin-ops-purge"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("365");

    let release!: () => void;
    server.holds.push({
      match: "/admin/retention/purge",
      promise: new Promise<void>((resolve) => {
        release = resolve;
      }),
    });
    const accept = within(dialog).getByTestId("admin-confirm-accept");
    fireEvent.click(accept);
    fireEvent.click(accept);
    await waitFor(() => expect(accept).toBeDisabled());
    release();

    await waitFor(() => {
      const purges = server.requests.filter(
        (request) =>
          request.method === "POST" &&
          request.path === "/admin/retention/purge",
      );
      expect(purges).toHaveLength(1);
      expect(purges[0]?.body).toEqual({ retentionDays: 365 });
    });
    // The eligible counts are fetched for the same visible window.
    await waitFor(() =>
      expect(
        server.requests.some(
          (request) =>
            request.method === "GET" &&
            request.path === "/admin/retention" &&
            request.query.get("retentionDays") === "365",
        ),
      ).toBe(true),
    );
  });

  it("varies retention counts by window and keeps data inside a 365-day draft (QA review)", async () => {
    const server = serverWith();
    server.ops.retentionDays = 30;
    // One soft-deleted row that is 60 days old.
    server.retentionDeletedAges = [60];
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/settings?tab=general");

    const input = await screen.findByTestId("admin-ops-retention");
    await waitFor(() =>
      expect(
        screen.getByTestId("admin-ops-retention-counts"),
      ).toHaveTextContent(
        t("admin.ops.retention.purgeable", {
          cards: 1,
          comments: 0,
          attachments: 0,
          columns: 0,
        }),
      ),
    );

    fireEvent.change(input, { target: { value: "365" } });
    await waitFor(() =>
      expect(
        screen.getByTestId("admin-ops-retention-counts"),
      ).toHaveTextContent(
        t("admin.ops.retention.purgeable", {
          cards: 0,
          comments: 0,
          attachments: 0,
          columns: 0,
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId("admin-ops-purge")).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId("admin-ops-purge"));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByTestId(
        "admin-confirm-accept",
      ),
    );
    await waitFor(() =>
      expect(
        server.requests.some(
          (request) =>
            request.path === "/admin/retention/purge" &&
            (request.body as { retentionDays?: number }).retentionDays === 365,
        ),
      ).toBe(true),
    );
    // The 60-day row is inside the 365-day window and must survive.
    expect(server.retentionDeletedAges).toEqual([60]);

    // Moving back to the saved 30-day window makes it eligible.
    fireEvent.change(input, { target: { value: "30" } });
    await waitFor(() =>
      expect(
        screen.getByTestId("admin-ops-retention-counts"),
      ).toHaveTextContent(
        t("admin.ops.retention.purgeable", {
          cards: 1,
          comments: 0,
          attachments: 0,
          columns: 0,
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId("admin-ops-purge")).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId("admin-ops-purge"));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByTestId(
        "admin-confirm-accept",
      ),
    );
    await waitFor(() => expect(server.retentionDeletedAges).toEqual([]));
  });

  it("does not claim zero rows or no backup directory when retention status fails (QA review)", async () => {
    const server = serverWith();
    server.ops.retentionDays = 30;
    server.failNextStatuses.push({ path: "/admin/retention", status: 500 });
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/settings?tab=general");

    expect(await screen.findByTestId("admin-ops-retention-error")).toBeTruthy();
    expect(screen.queryByText(t("admin.ops.backups.none"))).toBeNull();
    expect(screen.getByTestId("admin-ops-purge")).toBeDisabled();

    fireEvent.click(screen.getByTestId("admin-ops-retention-retry"));
    expect(
      await screen.findByTestId("admin-ops-retention-counts"),
    ).toHaveTextContent(
      t("admin.ops.retention.purgeable", {
        cards: 0,
        comments: 0,
        attachments: 0,
        columns: 0,
      }),
    );
    expect(screen.getByText(t("admin.ops.backups.none"))).toBeTruthy();
    expect(screen.getByTestId("admin-ops-purge")).not.toBeDisabled();
  });

  it("keeps an unsaved retention draft across sweeps and a flag failure (QA review)", async () => {
    const server = serverWith();
    server.ops.retentionDays = 30;
    server.retentionDeletedAges = [60];
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/settings?tab=general");

    const input = await screen.findByTestId("admin-ops-retention");
    fireEvent.change(input, { target: { value: "365" } });
    await screen.findByTestId("admin-ops-retention-dirty");
    const counts365 = t("admin.ops.retention.purgeable", {
      cards: 0,
      comments: 0,
      attachments: 0,
      columns: 0,
    });
    const expect365Ready = async () => {
      await waitFor(() =>
        expect(
          screen.getByTestId("admin-ops-retention-counts"),
        ).toHaveTextContent(counts365),
      );
      await waitFor(() =>
        expect(screen.getByTestId("admin-ops-purge")).not.toBeDisabled(),
      );
      expect(input).toHaveValue("365");
    };
    await expect365Ready();

    let before = server.requests.filter(
      (request) => request.path === "/admin/retention",
    ).length;
    fireEvent.click(screen.getByTestId("admin-ops-run-sweeps"));
    await waitFor(() =>
      expect(
        server.requests.filter(
          (request) => request.path === "/admin/retention",
        ),
      ).toHaveLength(before + 1),
    );
    await expect365Ready();

    server.failNext.push("/admin/flags/registration_open");
    before = server.requests.filter(
      (request) => request.path === "/admin/retention",
    ).length;
    fireEvent.click(screen.getAllByRole("switch")[0]);
    await waitFor(() =>
      expect(
        server.requests.filter(
          (request) => request.path === "/admin/retention",
        ),
      ).toHaveLength(before + 1),
    );
    await expect365Ready();
  });

  it("shows one invalid hint and never saves an out-of-range retention draft", async () => {
    const server = serverWith();
    server.ops.retentionDays = 30;
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/settings?tab=general");

    const input = await screen.findByTestId("admin-ops-retention");
    for (const invalid of ["0", "3651"]) {
      fireEvent.change(input, { target: { value: invalid } });
      // Exactly one validation message: the field hint.
      expect(screen.getAllByTestId("admin-ops-retention-invalid")).toHaveLength(
        1,
      );
      expect(
        screen.queryByTestId("admin-ops-retention-invalid-state"),
      ).toBeNull();
      expect(
        screen.queryByText(
          t("admin.ops.retention.olderThan", { days: Number(invalid) }),
        ),
      ).toBeNull();
      expect(screen.queryByTestId("admin-ops-retention-loading")).toBeNull();
      expect(screen.queryByTestId("admin-ops-retention-counts")).toBeNull();
      expect(screen.getByTestId("admin-ops-purge")).toBeDisabled();

      // Every Save entry point is disabled, including the retention panel.
      for (const id of [
        "admin-ops-save",
        "admin-ops-rate-limit-save",
        "admin-ops-retention-save",
        "admin-ops-schedule-save",
        "admin-ops-comms-save",
      ]) {
        const button = screen.getByTestId(id);
        expect(button).toBeDisabled();
        fireEvent.click(button);
      }
      expect(
        server.requests.some(
          (request) =>
            request.method === "PUT" && request.path === "/admin/ops",
        ),
      ).toBe(false);
    }

    fireEvent.change(input, { target: { value: "365" } });
    expect(
      await screen.findByTestId("admin-ops-retention-counts"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("admin-ops-retention-invalid")).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId("admin-ops-retention-save")).not.toBeDisabled(),
    );
  });

  it("keeps an edit made while a sweep reload is in flight", async () => {
    const server = serverWith();
    server.ops.retentionDays = 30;
    server.retentionDeletedAges = [60];
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/settings?tab=general");

    const input = await screen.findByTestId("admin-ops-retention");
    await waitFor(() =>
      expect(
        screen.getByTestId("admin-ops-retention-counts"),
      ).toHaveTextContent(
        t("admin.ops.retention.purgeable", {
          cards: 1,
          comments: 0,
          attachments: 0,
          columns: 0,
        }),
      ),
    );

    let release!: () => void;
    server.holds.push({
      match: "/admin/maintenance/run",
      promise: new Promise<void>((resolve) => {
        release = resolve;
      }),
    });
    fireEvent.click(screen.getByTestId("admin-ops-run-sweeps"));
    await waitFor(() =>
      expect(
        server.requests.some(
          (request) => request.path === "/admin/maintenance/run",
        ),
      ).toBe(true),
    );

    // Edit while the sweep request is still in flight; the reload it triggers
    // must read this newer draft, not the value captured at click time.
    fireEvent.change(input, { target: { value: "365" } });
    release();

    await waitFor(() =>
      expect(
        screen.getByTestId("admin-ops-retention-counts"),
      ).toHaveTextContent(
        t("admin.ops.retention.purgeable", {
          cards: 0,
          comments: 0,
          attachments: 0,
          columns: 0,
        }),
      ),
    );
    expect(input).toHaveValue("365");
    await waitFor(() =>
      expect(screen.getByTestId("admin-ops-purge")).not.toBeDisabled(),
    );
  });

  it("previews a mail template with sample placeholder values", async () => {
    const server = serverWith();
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/comms");

    fireEvent.click(
      await screen.findByTestId("admin-template-preview-verification_code"),
    );
    const frame = await screen.findByTestId("admin-template-preview-frame");
    // The draft's placeholders are filled with the sample values.
    expect(frame.getAttribute("srcdoc")).toContain("482913");
    expect(frame.getAttribute("srcdoc")).toContain("10 min");
  });

  it("shows the built-in email template by default and can reset an override", async () => {
    const server = serverWith();
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/comms");

    expect(await screen.findByText(t("admin.comms.default"))).toBeTruthy();
    expect(
      screen.getByText(
        t("admin.comms.templates.placeholders", {
          list: "{{code}}, {{minutes}}",
        }),
      ),
    ).toBeTruthy();
    expect(
      screen.queryByTestId("admin-template-reset-verification_code"),
    ).toBeNull();

    fireEvent.click(
      await screen.findByTestId("admin-template-save-verification_code"),
    );
    expect(
      await screen.findByTestId("admin-template-reset-verification_code"),
    ).toBeTruthy();

    // QA-A6: resetting authored content confirms first.
    fireEvent.click(
      screen.getByTestId("admin-template-reset-verification_code"),
    );
    const dialog = await screen.findByRole("dialog");
    expect(server.requests.some((request) => request.method === "DELETE")).toBe(
      false,
    );
    fireEvent.click(within(dialog).getByTestId("admin-confirm-accept"));
    await waitFor(() =>
      expect(
        server.requests.some(
          (request) =>
            request.method === "DELETE" &&
            request.path === "/admin/email-templates/verification_code",
        ),
      ).toBe(true),
    );
  });

  it("unlocks a locked master", async () => {
    const server = serverWith();
    server.masters = [
      adminMaster({ lockedUntil: 1_760_000_600_000, failedLogins: 5 }),
    ];
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/masters");

    fireEvent.pointerDown(
      await screen.findByTestId("admin-master-menu-operator@example.com"),
      { button: 0 },
    );
    fireEvent.click(await screen.findByText(t("admin.masters.action.unlock")));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByTestId("admin-confirm-accept"));

    await waitFor(() => {
      expect(
        server.requests.some(
          (request) =>
            request.method === "PATCH" &&
            request.path === "/admin/admins/master-2" &&
            (request.body as { unlock?: boolean }).unlock === true,
        ),
      ).toBe(true);
    });
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

    // QA-A5: the confirm is single-flight; a double click must not mint a
    // second temporary password.
    let release!: () => void;
    server.holds.push({
      match: "/admin/admins/master-2/password/reset",
      promise: new Promise<void>((resolve) => {
        release = resolve;
      }),
    });
    const accept = within(dialog).getByTestId("admin-confirm-accept");
    fireEvent.click(accept);
    fireEvent.click(accept);
    await waitFor(() => expect(accept).toBeDisabled());
    release();

    expect(
      await screen.findByTestId("admin-master-password"),
    ).toHaveTextContent("reset-one-time-pass");
    expect(
      server.requests.filter(
        (request) =>
          request.method === "POST" &&
          request.path === "/admin/admins/master-2/password/reset",
      ),
    ).toHaveLength(1);
  });

  it("times out a hung master reset and releases the confirm", async () => {
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
    server.holds.push({
      match: "/admin/admins/master-2/password/reset",
      promise: new Promise<void>(() => {
        /* held forever */
      }),
    });
    const accept = within(dialog).getByTestId("admin-confirm-accept");
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      fireEvent.click(accept);
      await act(async () => {
        await Promise.resolve();
      });
      expect(accept).toBeDisabled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(
        screen.getByText(t("admin.masters.reset.timeout")),
      ).toBeInTheDocument();
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      vi.useRealTimers();
    }

    // The roster is usable again: the same reset action can be started.
    fireEvent.pointerDown(
      screen.getByTestId("admin-master-menu-operator@example.com"),
      { button: 0 },
    );
    expect(
      await screen.findByText(t("admin.masters.action.resetPassword")),
    ).toBeInTheDocument();
  });

  it("keeps the reset-password dialog open until the one-time secret arrives (QA-A2)", async () => {
    const state = serverWith().state;
    state.users = [adminUser()];
    const server = new FakeAdminServer(state);
    let release!: () => void;
    server.holds.push({
      match: "/admin/users/u-1/password/reset",
      promise: new Promise<void>((resolve) => {
        release = resolve;
      }),
    });
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/users/u-1");

    fireEvent.pointerDown(
      await screen.findByTestId("admin-user-detail-actions"),
      { button: 0 },
    );
    fireEvent.click(await screen.findByTestId("admin-user-reset-password"));

    const dialog = await screen.findByTestId("admin-reset-password-dialog");
    // The X is gone and the footer Close is disabled while the request runs.
    expect(within(dialog).queryByTestId("dialog-close")).toBeNull();
    const close = within(dialog).getByRole("button", {
      name: t("admin.common.close"),
    });
    expect(close).toBeDisabled();
    fireEvent.click(close);
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });
    expect(screen.getByTestId("admin-reset-password-dialog")).toBeTruthy();

    release();
    expect(
      await screen.findByTestId("admin-reset-password-value"),
    ).toHaveTextContent("Temp-pass-123");
  });

  it("guards the create-master secret while pending and clears it on reopen", async () => {
    const server = serverWith();
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/masters");

    fireEvent.click(await screen.findByTestId("admin-create-master"));
    fireEvent.change(await screen.findByTestId("admin-master-email"), {
      target: { value: "new-owner@example.com" },
    });
    const dialog = await screen.findByRole("dialog");
    const cancel = within(dialog).getByRole("button", {
      name: t("admin.common.cancel"),
    });
    let release!: () => void;
    server.holds.push({
      match: "/admin/admins",
      promise: new Promise<void>((resolve) => {
        release = resolve;
      }),
    });
    fireEvent.click(within(dialog).getByTestId("admin-master-submit"));
    await waitFor(() => expect(cancel).toBeDisabled());
    expect(within(dialog).queryByTestId("dialog-close")).toBeNull();
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });
    expect(screen.getByRole("dialog")).toBeTruthy();

    release();
    expect(await screen.findByTestId("admin-master-password")).toBeTruthy();
    fireEvent.click(screen.getByTestId("admin-master-done"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Reopening starts clean: the previous one-time secret is gone.
    fireEvent.click(screen.getByTestId("admin-create-master"));
    expect(await screen.findByTestId("admin-master-email")).toHaveValue("");
    expect(screen.queryByTestId("admin-master-password")).toBeNull();
  });

  it("guards the promote secret while pending and clears it on reopen", async () => {
    const state = serverWith().state;
    state.users = [adminUser()];
    const server = new FakeAdminServer(state);
    let release!: () => void;
    server.holds.push({
      match: "/admin/users/u-1/promote",
      promise: new Promise<void>((resolve) => {
        release = resolve;
      }),
    });
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/users/u-1");

    const openDialog = async () => {
      fireEvent.pointerDown(
        await screen.findByTestId("admin-user-detail-actions"),
        { button: 0 },
      );
      fireEvent.click(await screen.findByTestId("admin-user-promote"));
    };
    await openDialog();
    const dialog = await screen.findByTestId("admin-promote-user-dialog");
    fireEvent.change(within(dialog).getByTestId("admin-promote-user-input"), {
      target: { value: "member@example.com" },
    });
    const cancel = within(dialog).getByRole("button", {
      name: t("admin.common.cancel"),
    });
    fireEvent.click(within(dialog).getByTestId("admin-promote-user-submit"));
    await waitFor(() => expect(cancel).toBeDisabled());
    expect(within(dialog).queryByTestId("dialog-close")).toBeNull();
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });
    expect(screen.getByTestId("admin-promote-user-dialog")).toBeTruthy();

    release();
    expect(
      await screen.findByTestId("admin-promote-password"),
    ).toHaveTextContent("Temp-pass-123");
    fireEvent.click(
      within(dialog).getAllByRole("button", {
        name: t("admin.common.close"),
      })[0],
    );
    await waitFor(() =>
      expect(screen.queryByTestId("admin-promote-user-dialog")).toBeNull(),
    );

    await openDialog();
    await screen.findByTestId("admin-promote-user-dialog");
    expect(screen.queryByTestId("admin-promote-password")).toBeNull();
  });

  it("times out a hung reset and re-enables Close (QA review)", async () => {
    const state = serverWith().state;
    state.users = [adminUser()];
    const server = new FakeAdminServer(state);
    server.holds.push({
      match: "/admin/users/u-1/password/reset",
      promise: new Promise<void>(() => {
        /* never resolves */
      }),
    });
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/users/u-1");

    fireEvent.pointerDown(
      await screen.findByTestId("admin-user-detail-actions"),
      { button: 0 },
    );
    const resetItem = await screen.findByTestId("admin-user-reset-password");
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      fireEvent.click(resetItem);
      await act(async () => {
        await Promise.resolve();
      });
      const dialog = screen.getByTestId("admin-reset-password-dialog");
      expect(
        within(dialog).getByRole("button", { name: t("admin.common.close") }),
      ).toBeDisabled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(
        within(dialog).getByText(t("admin.userDetail.reset.timeout")),
      ).toBeInTheDocument();
      expect(
        within(dialog).getAllByRole("button", {
          name: t("admin.common.close"),
        })[0],
      ).not.toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
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

  it("hides the closed phone drawer from focus and names icon-only controls (QA-A11/A12)", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(max-width: 639px)",
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }));
    const server = serverWith();
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin");

    const sidebar = await screen.findByTestId("admin-sidebar");
    await waitFor(() => expect(sidebar).toHaveAttribute("inert"));
    // Icon-only controls keep an accessible name at phone widths.
    expect(
      screen.getByRole("button", { name: t("admin.search.title") }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: t("admin.nav.logout") }),
    ).toBeTruthy();

    fireEvent.click(screen.getByTestId("admin-sidebar-toggle"));
    await waitFor(() => expect(sidebar).not.toHaveAttribute("inert"));
  });

  it("closes the phone sheet before opening all destinations (390 regression)", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(max-width: 639px)",
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }));
    const server = serverWith();
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin");

    const sidebar = await screen.findByTestId("admin-sidebar");
    await waitFor(() => expect(sidebar).toHaveAttribute("inert"));
    fireEvent.click(screen.getByTestId("admin-sidebar-toggle"));
    await waitFor(() =>
      expect(sidebar).toHaveAttribute("data-mobile-open", "true"),
    );

    fireEvent.click(screen.getByTestId("admin-all-destinations"));
    await waitFor(() =>
      expect(sidebar).toHaveAttribute("data-mobile-open", "false"),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(t("admin.hub.allDestinationsDescription")),
    ).toBeTruthy();
    expect(within(dialog).getAllByRole("link")).toHaveLength(26);
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
    // The icon-only link keeps an accessible name for screen readers.
    expect(
      within(screen.getByTestId("admin-sidebar")).getByRole("link", {
        name: t("admin.nav.users"),
      }),
    ).toBeTruthy();
    expect(localStorage.getItem("janosik.admin.sidebar")).toBe("1");
  });

  it("toggles the light / dark theme from the top bar", async () => {
    const server = serverWith();
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin");

    const toggle = await screen.findByTestId("admin-theme-toggle");
    const startedDark = document.documentElement.classList.contains("dark");
    expect(toggle).toHaveAttribute("aria-pressed", String(startedDark));

    fireEvent.click(toggle);
    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(
        !startedDark,
      );
    });
    expect(toggle).toHaveAttribute("aria-pressed", String(!startedDark));
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
    const boardLink = cardLink.querySelector('a[href^="/admin/boards/b-7"]');
    expect(boardLink).not.toBeNull();
    const boardHref = new URL(
      boardLink?.getAttribute("href") ?? "",
      "http://admin.test",
    );
    expect(boardHref.pathname).toBe("/admin/boards/b-7");
    // The cards tab is the current context: its back control returns there.
    expect(boardHref.searchParams.get("returnTo")).toBe(
      "/admin/boards?tab=cards",
    );
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
    state.activity = [
      adminActivity({
        type: "member_role_changed",
        details: { email: "member@example.com", from: "VIEWER", to: "MEMBER" },
      }),
    ];
    const server = new FakeAdminServer(state);
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/activity");

    fireEvent.click(await screen.findByText(t("admin.filter.period.24h")));
    await screen.findByText("member_role_changed");
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

  it("hides raw details on comment activity rows", async () => {
    const state = serverWith().state;
    state.activity = [adminActivity()];
    vi.stubGlobal("fetch", new FakeAdminServer(state).fetchImpl);
    renderAdmin("/admin/activity");

    await screen.findByText("comment_added");
    expect(screen.queryByText(/Looks good/)).toBeNull();
    expect(
      screen.queryByTestId("admin-activity-details-activity-1"),
    ).toBeNull();
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

  it("moves a card between columns and records a correlated audit row", async () => {
    const state = serverWith().state;
    state.cards = [
      adminCard({
        id: "card-1",
        title: "Movable",
        columnId: "col-a",
        columnTitle: "Backlog",
      }),
    ];
    state.contentBoard = contentBoard({
      columns: [
        { id: "col-a", title: "Backlog", cardIds: ["card-1"], createdAt: 1 },
        { id: "col-b", title: "Done", cardIds: [], createdAt: 2 },
      ],
      cards: {
        "card-1": {
          id: "card-1",
          title: "Movable",
          labelIds: [],
          createdAt: 1,
          updatedAt: 1,
        },
      },
    });
    const server = new FakeAdminServer(state);
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/boards/b-1/content");

    fireEvent.click(await screen.findByTestId("admin-card-move-card-1"));
    const dialog = await screen.findByTestId("admin-move-card-dialog");
    expect(
      within(dialog).getByTestId("admin-move-card-owner-notice"),
    ).toHaveTextContent(t("admin.common.actingAsOwner"));

    fireEvent.click(within(dialog).getByTestId("admin-move-card-target"));
    fireEvent.click(
      await screen.findByTestId("admin-move-card-target-option-col-b"),
    );
    fireEvent.click(within(dialog).getByTestId("admin-move-card-submit"));

    await waitFor(() => {
      expect(state.contentBoard?.columns[1].cardIds).toEqual(["card-1"]);
      expect(state.contentBoard?.columns[0].cardIds).toEqual([]);
    });
    const sent = server.requests
      .filter((request) => request.path.endsWith("/commands"))
      .at(-1)?.body as {
      commandId?: string;
      action: Record<string, unknown>;
    };
    expect(sent.commandId).toEqual(expect.any(String));
    expect(sent.action).toMatchObject({
      type: "MOVE_CARD",
      cardId: "card-1",
      fromColumnId: "col-a",
      fromIndex: 0,
      toColumnId: "col-b",
      toIndex: 0,
    });
    expect(state.commands[0]).toMatchObject({
      type: "MOVE_CARD",
      auditId: expect.any(String),
    });
    expect(state.audit[0]).toMatchObject({
      action: "board.command",
      details: {
        commandId: state.commands[0].id,
        masterId: "master-1",
        masterEmail: "master@example.com",
      },
    });
  });

  it("shows a stale toast when the move source vanished after the poll", async () => {
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.useFakeTimers({ toFake: ["setInterval"] });
    try {
      const state = serverWith().state;
      state.cards = [
        adminCard({
          id: "card-1",
          title: "Movable",
          columnId: "col-a",
          columnTitle: "Backlog",
        }),
      ];
      state.contentBoard = contentBoard({
        columns: [
          { id: "col-a", title: "Backlog", cardIds: ["card-1"], createdAt: 1 },
          { id: "col-b", title: "Done", cardIds: [], createdAt: 2 },
        ],
        cards: {
          "card-1": {
            id: "card-1",
            title: "Movable",
            labelIds: [],
            createdAt: 1,
            updatedAt: 1,
          },
        },
      });
      const server = new FakeAdminServer(state);
      vi.stubGlobal("fetch", server.fetchImpl);
      renderAdmin("/admin/boards/b-1/content");

      fireEvent.click(await screen.findByTestId("admin-card-move-card-1"));
      const dialog = await screen.findByTestId("admin-move-card-dialog");
      fireEvent.click(within(dialog).getByTestId("admin-move-card-target"));
      fireEvent.click(
        await screen.findByTestId("admin-move-card-target-option-col-b"),
      );

      // Someone else moves the card before the 2s poll refreshes this tab.
      state.contentBoard.columns[0]!.cardIds = [];
      state.contentBoard.columns[1]!.cardIds = ["card-1"];
      await act(async () => {
        vi.advanceTimersByTime(2000);
        await Promise.resolve();
      });
      vi.useRealTimers();

      fireEvent.click(within(dialog).getByTestId("admin-move-card-submit"));
      expect(
        await screen.findByText(t("admin.boardContent.move.stale")),
      ).toBeTruthy();
      expect(
        server.requests.filter(
          (request) =>
            request.method === "POST" && request.path.endsWith("/commands"),
        ),
      ).toHaveLength(0);
      expect(screen.queryByTestId("admin-move-card-dialog")).toBeNull();
    } finally {
      vi.useRealTimers();
      hasFocus.mockRestore();
    }
  });

  it("closes the move dialog and reloads on a server move_stale conflict", async () => {
    const state = serverWith().state;
    state.cards = [adminCard({ id: "card-1", columnId: "col-a" })];
    state.contentBoard = contentBoard({
      columns: [
        { id: "col-a", title: "Backlog", cardIds: ["card-1"], createdAt: 1 },
        { id: "col-b", title: "Done", cardIds: [], createdAt: 2 },
      ],
      cards: {
        "card-1": {
          id: "card-1",
          title: "Movable",
          labelIds: [],
          createdAt: 1,
          updatedAt: 1,
        },
      },
    });
    const server = new FakeAdminServer(state);
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/boards/b-1/content");

    fireEvent.click(await screen.findByTestId("admin-card-move-card-1"));
    const dialog = await screen.findByTestId("admin-move-card-dialog");
    fireEvent.click(within(dialog).getByTestId("admin-move-card-target"));
    fireEvent.click(
      await screen.findByTestId("admin-move-card-target-option-col-b"),
    );
    server.failNextStatuses.push({
      path: "/commands",
      status: 409,
      body: { code: "move_stale", conflict: "version" },
    });
    fireEvent.click(within(dialog).getByTestId("admin-move-card-submit"));

    expect(
      await screen.findByText(t("admin.boardContent.move.stale")),
    ).toBeTruthy();
    expect(screen.queryByTestId("admin-move-card-dialog")).toBeNull();
    expect(state.contentBoard.columns[0]?.cardIds).toEqual(["card-1"]);
  });

  it("localizes a vanished target column and closes the dialog", async () => {
    const state = serverWith().state;
    state.cards = [adminCard({ id: "card-1", columnId: "col-a" })];
    state.contentBoard = contentBoard({
      columns: [
        { id: "col-a", title: "Backlog", cardIds: ["card-1"], createdAt: 1 },
        { id: "col-b", title: "Done", cardIds: [], createdAt: 2 },
      ],
      cards: {
        "card-1": {
          id: "card-1",
          title: "Movable",
          labelIds: [],
          createdAt: 1,
          updatedAt: 1,
        },
      },
    });
    const server = new FakeAdminServer(state);
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/boards/b-1/content");

    fireEvent.click(await screen.findByTestId("admin-card-move-card-1"));
    const dialog = await screen.findByTestId("admin-move-card-dialog");
    fireEvent.click(within(dialog).getByTestId("admin-move-card-target"));
    fireEvent.click(
      await screen.findByTestId("admin-move-card-target-option-col-b"),
    );
    server.failNextStatuses.push({
      path: "/commands",
      status: 404,
      body: {
        message: "Target column not found",
        field: "action.toColumnId",
      },
    });
    fireEvent.click(within(dialog).getByTestId("admin-move-card-submit"));

    expect(
      await screen.findByText(t("admin.boardContent.move.targetGone")),
    ).toBeTruthy();
    expect(screen.queryByTestId("admin-move-card-dialog")).toBeNull();
    expect(state.contentBoard.columns[0]?.cardIds).toEqual(["card-1"]);
  });

  it("disables moving for a single-column board and an archived card", async () => {
    const single = serverWith().state;
    single.cards = [adminCard({ id: "card-1", columnId: "col-a" })];
    single.contentBoard = contentBoard({
      columns: [
        { id: "col-a", title: "Only", cardIds: ["card-1"], createdAt: 1 },
      ],
      cards: {
        "card-1": {
          id: "card-1",
          title: "Movable",
          labelIds: [],
          createdAt: 1,
          updatedAt: 1,
        },
      },
    });
    vi.stubGlobal("fetch", new FakeAdminServer(single).fetchImpl);
    const view = renderAdmin("/admin/boards/b-1/content");
    fireEvent.click(await screen.findByTestId("admin-column-col-a"));
    expect(await screen.findByTestId("admin-card-move-card-1")).toBeDisabled();
    view.unmount();

    const archived = serverWith().state;
    archived.cards = [
      adminCard({
        id: "card-1",
        columnId: "col-a",
        archivedAt: 1_760_000_000_000,
      }),
    ];
    archived.contentBoard = contentBoard({
      columns: [
        { id: "col-a", title: "Backlog", cardIds: ["card-1"], createdAt: 1 },
        { id: "col-b", title: "Done", cardIds: [], createdAt: 2 },
      ],
      cards: {
        "card-1": {
          id: "card-1",
          title: "Movable",
          labelIds: [],
          archivedAt: 1_760_000_000_000,
          createdAt: 1,
          updatedAt: 1,
        },
      },
    });
    vi.stubGlobal("fetch", new FakeAdminServer(archived).fetchImpl);
    renderAdmin("/admin/boards/b-1/content");
    fireEvent.click(await screen.findByTestId("admin-column-col-a"));
    expect(await screen.findByTestId("admin-card-move-card-1")).toBeDisabled();
  });

  it("omits the current column from the move target and cancel sends nothing", async () => {
    const state = serverWith().state;
    state.cards = [adminCard({ id: "card-1", columnId: "col-a" })];
    state.contentBoard = contentBoard({
      columns: [
        { id: "col-a", title: "Backlog", cardIds: ["card-1"], createdAt: 1 },
        { id: "col-b", title: "Done", cardIds: [], createdAt: 2 },
      ],
      cards: {
        "card-1": {
          id: "card-1",
          title: "Movable",
          labelIds: [],
          createdAt: 1,
          updatedAt: 1,
        },
      },
    });
    const server = new FakeAdminServer(state);
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/boards/b-1/content");

    fireEvent.click(await screen.findByTestId("admin-column-col-a"));
    fireEvent.click(screen.getByTestId("admin-card-move-card-1"));
    const dialog = await screen.findByTestId("admin-move-card-dialog");
    fireEvent.click(within(dialog).getByTestId("admin-move-card-target"));
    expect(
      await screen.findByTestId("admin-move-card-target-option-col-b"),
    ).toBeTruthy();
    expect(
      screen.queryByTestId("admin-move-card-target-option-col-a"),
    ).toBeNull();

    fireEvent.click(
      within(dialog).getByRole("button", { name: t("admin.common.cancel") }),
    );
    await waitFor(() => {
      expect(screen.queryByTestId("admin-move-card-dialog")).toBeNull();
    });
    expect(
      server.requests.filter((request) => request.path.endsWith("/commands")),
    ).toHaveLength(0);
  });

  it("keeps the move dialog open when the server refuses", async () => {
    const state = serverWith().state;
    state.cards = [adminCard({ id: "card-1", columnId: "col-a" })];
    state.contentBoard = contentBoard({
      columns: [
        { id: "col-a", title: "Backlog", cardIds: ["card-1"], createdAt: 1 },
        { id: "col-b", title: "Done", cardIds: [], createdAt: 2 },
      ],
      cards: {
        "card-1": {
          id: "card-1",
          title: "Movable",
          labelIds: [],
          createdAt: 1,
          updatedAt: 1,
        },
      },
    });
    const server = new FakeAdminServer(state);
    server.failNextStatuses.push({ path: "/commands", status: 409 });
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/boards/b-1/content");

    fireEvent.click(await screen.findByTestId("admin-column-col-a"));
    fireEvent.click(screen.getByTestId("admin-card-move-card-1"));
    const dialog = await screen.findByTestId("admin-move-card-dialog");
    fireEvent.click(within(dialog).getByTestId("admin-move-card-target"));
    fireEvent.click(
      await screen.findByTestId("admin-move-card-target-option-col-b"),
    );
    fireEvent.click(within(dialog).getByTestId("admin-move-card-submit"));

    expect(await screen.findByText("denied")).toBeTruthy();
    expect(screen.getByTestId("admin-move-card-dialog")).toBeTruthy();
    expect(state.contentBoard?.columns[0].cardIds).toEqual(["card-1"]);
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

  it("surfaces the server's reason when the allowlist would lock the caller out", async () => {
    const server = serverWith();
    server.callerIp = "203.0.113.7";
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/security");

    fireEvent.change(await screen.findByTestId("admin-ip-allowlist"), {
      target: { value: "10.0.0.0/8" },
    });
    fireEvent.click(screen.getByTestId("admin-ip-save"));
    expect(
      await screen.findByText(
        "The allowlist must include your current address (203.0.113.7)",
      ),
    ).toBeTruthy();
    expect(server.security.ipAllowlist).not.toBe("10.0.0.0/8");
  });

  it("hides all owner-only account actions from an operator", async () => {
    const state = serverWith().state;
    state.users = [adminUser()];
    const server = new FakeAdminServer(state);
    server.sessionRole = "OPERATOR";
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/users/u-1");

    fireEvent.pointerDown(
      await screen.findByTestId("admin-user-detail-actions"),
      { button: 0 },
    );
    // H7: email/verification moves are owner-only, so an operator never sees
    // them — and the server refuses them with 403 if the request is forged.
    for (const testId of [
      "admin-user-change-email",
      "admin-user-unverify",
      "admin-user-verify",
      "admin-user-reset-password",
      "admin-user-promote",
      "admin-user-impersonate",
      "admin-user-export",
      "admin-user-delete",
    ]) {
      expect(screen.queryByTestId(testId)).toBeNull();
    }
    const forged = await fetch("/api/v1/admin/users/u-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emailVerified: true }),
    });
    expect(forged.status).toBe(403);
  });

  it("leaves owner-only actions out of an operator's users row menu", async () => {
    const state = serverWith().state;
    state.users = [adminUser()];
    const server = new FakeAdminServer(state);
    server.sessionRole = "OPERATOR";
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/users");

    fireEvent.pointerDown(await screen.findByTestId("admin-row-actions-u-1"), {
      button: 0,
    });
    for (const key of [
      "admin.users.action.changeEmail",
      "admin.userDetail.action.verify",
      "admin.userDetail.action.unverify",
      "admin.userDetail.action.resetPassword",
      "admin.userDetail.action.promote",
      "admin.userDetail.action.impersonate",
      "admin.userDetail.action.export",
      "admin.userDetail.action.deleteUser",
    ] as const) {
      expect(screen.queryByText(t(key))).toBeNull();
    }
  });
});
