import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { I18nProvider } from "@/i18n";
import { defaultI18n, ensureLocale } from "@/i18n/i18n";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { adminApi } from "./admin-client";
import AdminApp from "./AdminApp";
import { FakeAdminServer } from "./test/fake-admin-server";

afterEach(() => {
  vi.unstubAllGlobals();
  adminApi.clearAccessToken();
  adminApi.onAuthLost = null;
});

describe.each([
  ["en", "IP address not allowed", "Request", "IP unavailable", "Occurrences"],
  ["ru", "IP-адрес запрещён", "Запрос", "IP неизвестен", "Повторений"],
] as const)("security alerts (%s)", (lang, reason, stage, noIp, count) => {
  it("shows localized reasons, stages, addresses and repeated events", async () => {
    await ensureLocale(lang);
    await defaultI18n.changeLanguage(lang);
    const server = new FakeAdminServer();
    server.security.alerts = [
      {
        id: "1",
        action: "admin.login_failed",
        adminEmail: "master@example.com",
        ip: null,
        reason: "ip_not_allowed",
        stage: "request",
        count: 3,
        createdAt: Date.now() - 1000,
        lastOccurredAt: Date.now(),
        detail: "",
      },
      {
        id: "2",
        action: "admin.login_failed",
        adminEmail: "other@example.com",
        ip: "192.0.2.1",
        reason: "wrong_password",
        stage: "login",
        count: 1,
        createdAt: Date.now(),
        lastOccurredAt: Date.now(),
        detail: "",
      },
    ];
    vi.stubGlobal("fetch", server.fetchImpl);
    render(
      <ThemeProvider>
        <I18nProvider>
          <ToastProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={["/admin/security"]}>
                <Routes>
                  <Route path="/admin/*" element={<AdminApp />} />
                </Routes>
              </MemoryRouter>
            </TooltipProvider>
          </ToastProvider>
        </I18nProvider>
      </ThemeProvider>,
    );
    expect(await screen.findByText(reason)).toBeTruthy();
    expect(screen.getByText(stage)).toBeTruthy();
    expect(screen.getByText(noIp)).toBeTruthy();
    expect(screen.getByText("192.0.2.1")).toBeTruthy();
    expect(screen.getByText(new RegExp(count))).toBeTruthy();
  });
});

describe("2FA replacement staging", () => {
  it("maps a rejected current proof to the invalid-code message", async () => {
    await ensureLocale("en");
    await defaultI18n.changeLanguage("en");
    const server = new FakeAdminServer();
    server.security = {
      ...server.security,
      totpEnabled: true,
      alerts: [],
    };
    vi.stubGlobal("fetch", server.fetchImpl);
    render(
      <ThemeProvider>
        <I18nProvider>
          <ToastProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={["/admin/security"]}>
                <Routes>
                  <Route path="/admin/*" element={<AdminApp />} />
                </Routes>
              </MemoryRouter>
            </TooltipProvider>
          </ToastProvider>
        </I18nProvider>
      </ThemeProvider>,
    );

    fireEvent.change(await screen.findByTestId("admin-totp-password"), {
      target: { value: "wrong password" },
    });
    fireEvent.click(screen.getByTestId("admin-totp-replace"));
    expect(await screen.findByText("Invalid code")).toBeTruthy();
    expect(screen.queryByTestId("admin-totp-setup")).toBeNull();
  });

  it("uses the password proof, focuses the setup panel and sends its ticket", async () => {
    await ensureLocale("en");
    await defaultI18n.changeLanguage("en");
    const server = new FakeAdminServer();
    server.security = {
      ...server.security,
      totpEnabled: true,
      alerts: [],
    };
    vi.stubGlobal("fetch", server.fetchImpl);
    render(
      <ThemeProvider>
        <I18nProvider>
          <ToastProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={["/admin/security"]}>
                <Routes>
                  <Route path="/admin/*" element={<AdminApp />} />
                </Routes>
              </MemoryRouter>
            </TooltipProvider>
          </ToastProvider>
        </I18nProvider>
      </ThemeProvider>,
    );

    fireEvent.change(await screen.findByTestId("admin-totp-password"), {
      target: { value: "master correct horse battery" },
    });
    fireEvent.click(screen.getByTestId("admin-totp-replace"));
    const setup = await screen.findByTestId("admin-totp-setup");
    expect(setup).toHaveAttribute("aria-live", "polite");
    const code = screen.getByTestId("admin-totp-code");
    await waitFor(() => expect(code).toHaveFocus());

    fireEvent.change(code, { target: { value: "123456" } });
    fireEvent.click(screen.getByTestId("admin-totp-confirm"));
    await waitFor(() =>
      expect(
        server.requests.some(
          (request) =>
            request.path === "/admin/security/totp/verify" &&
            (request.body as { setupToken?: string } | undefined)
              ?.setupToken === "fake-totp-setup-token",
        ),
      ).toBe(true),
    );
  });

  it("keeps Disable 2FA busy until the server answers", async () => {
    await ensureLocale("en");
    await defaultI18n.changeLanguage("en");
    const server = new FakeAdminServer();
    server.security = {
      ...server.security,
      totpEnabled: true,
      alerts: [],
    };
    const original = server.fetchImpl;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/admin/security") && init?.method === "PUT") {
        return gate.then(() => original(input, init));
      }
      return original(input, init);
    });
    render(
      <ThemeProvider>
        <I18nProvider>
          <ToastProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={["/admin/security"]}>
                <Routes>
                  <Route path="/admin/*" element={<AdminApp />} />
                </Routes>
              </MemoryRouter>
            </TooltipProvider>
          </ToastProvider>
        </I18nProvider>
      </ThemeProvider>,
    );

    fireEvent.change(await screen.findByTestId("admin-totp-code"), {
      target: { value: "123456" },
    });
    const disable = screen.getByTestId("admin-totp-disable");
    fireEvent.click(disable);
    expect(disable).toBeDisabled();
    release();
    expect(await screen.findByTestId("admin-totp-enable")).toBeTruthy();
  });

  it("clears the dead setup panel on setup_stale", async () => {
    await ensureLocale("en");
    await defaultI18n.changeLanguage("en");
    const server = new FakeAdminServer();
    server.security = {
      ...server.security,
      totpEnabled: true,
      alerts: [],
    };
    const original = server.fetchImpl;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/admin/security/totp/verify")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              message: "This enrollment was superseded",
              code: "setup_stale",
            }),
            {
              status: 409,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }
      return original(input, init);
    });
    render(
      <ThemeProvider>
        <I18nProvider>
          <ToastProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={["/admin/security"]}>
                <Routes>
                  <Route path="/admin/*" element={<AdminApp />} />
                </Routes>
              </MemoryRouter>
            </TooltipProvider>
          </ToastProvider>
        </I18nProvider>
      </ThemeProvider>,
    );

    fireEvent.change(await screen.findByTestId("admin-totp-password"), {
      target: { value: "master correct horse battery" },
    });
    fireEvent.click(screen.getByTestId("admin-totp-replace"));
    await screen.findByTestId("admin-totp-setup");
    fireEvent.change(screen.getByTestId("admin-totp-code"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByTestId("admin-totp-confirm"));

    expect(
      await screen.findByText(
        "This enrollment was superseded by a newer security change — start again",
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId("admin-totp-setup")).toBeNull();
  });
});
