import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
