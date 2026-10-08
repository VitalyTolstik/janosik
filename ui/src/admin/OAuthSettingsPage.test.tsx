import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { I18nProvider } from "@/i18n";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { adminApi } from "./admin-client";
import AdminApp from "./AdminApp";
import { adminMessage } from "./admin-i18n";
import { FakeAdminServer } from "./test/fake-admin-server";

/**
 * OAuth login page (TASK-54) against the in-memory fake admin API: the
 * masked bootstrap state, the owner save flow (secret stays blank = keep),
 * the operator read-only view and enabling without a secret being refused.
 */

const t = (
  key: Parameters<typeof adminMessage>[0],
  params?: Record<string, string | number>,
) => adminMessage(key, "en", params);

function renderOauthSettings() {
  return render(
    <I18nProvider>
      <ToastProvider>
        <TooltipProvider>
          <MemoryRouter initialEntries={["/admin/oauth"]}>
            <Routes>
              <Route path="/admin/*" element={<AdminApp />} />
            </Routes>
          </MemoryRouter>
        </TooltipProvider>
      </ToastProvider>
    </I18nProvider>,
  );
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

describe("OAuthSettingsPage", () => {
  it("renders both providers with their callback URLs and masked secrets", async () => {
    const server = new FakeAdminServer();
    server.oauthProviders = server.oauthProviders.map((row) =>
      row.provider === "google"
        ? { ...row, clientId: "google-app-id", hasSecret: true, enabled: true }
        : row,
    );
    vi.stubGlobal("fetch", server.fetchImpl);
    renderOauthSettings();

    expect(
      await screen.findByTestId("admin-oauth-callback-google"),
    ).toHaveTextContent("http://app.test/api/v1/auth/oauth/google/callback");
    expect(screen.getByTestId("admin-oauth-callback-yandex")).toHaveTextContent(
      "http://app.test/api/v1/auth/oauth/yandex/callback",
    );
    expect(
      (screen.getByTestId("admin-oauth-client-id-google") as HTMLInputElement)
        .value,
    ).toBe("google-app-id");
    expect(screen.getByTestId("admin-oauth-status-google").textContent).toBe(
      t("admin.oauth.status.on"),
    );
    expect(screen.getByTestId("admin-oauth-status-yandex").textContent).toBe(
      t("admin.oauth.status.off"),
    );
  });

  it("saves a provider from the owner session and keeps a blank secret", async () => {
    const server = new FakeAdminServer();
    server.oauthProviders = server.oauthProviders.map((row) =>
      row.provider === "google"
        ? { ...row, clientId: "old-id", hasSecret: true }
        : row,
    );
    vi.stubGlobal("fetch", server.fetchImpl);
    renderOauthSettings();

    const clientId = (await screen.findByTestId(
      "admin-oauth-client-id-google",
    )) as HTMLInputElement;
    fireEvent.change(clientId, { target: { value: "new-app-id" } });
    // Blank secret field = keep the stored one.
    fireEvent.click(screen.getByTestId("admin-oauth-enabled-google"));
    fireEvent.click(screen.getByTestId("admin-oauth-save-google"));

    await waitFor(() =>
      expect(screen.getByTestId("admin-oauth-status-yandex").textContent).toBe(
        t("admin.oauth.status.off"),
      ),
    );
    const google = server.oauthProviders.find(
      (row) => row.provider === "google",
    );
    expect(google).toMatchObject({
      clientId: "new-app-id",
      enabled: true,
      hasSecret: true,
    });
    const put = server.requests.find(
      (call) =>
        call.method === "PUT" && call.path === "/admin/oauth-providers/google",
    );
    expect(put?.body).toEqual({ clientId: "new-app-id", enabled: true });
  });

  it("refuses enabling a provider without any stored secret", async () => {
    const server = new FakeAdminServer();
    vi.stubGlobal("fetch", server.fetchImpl);
    renderOauthSettings();

    const clientId = (await screen.findByTestId(
      "admin-oauth-client-id-google",
    )) as HTMLInputElement;
    fireEvent.change(clientId, { target: { value: "fresh-id" } });
    fireEvent.click(screen.getByTestId("admin-oauth-enabled-google"));
    fireEvent.click(screen.getByTestId("admin-oauth-save-google"));

    await screen.findByText("Client secret is required to enable the provider");
    expect(
      server.oauthProviders.find((row) => row.provider === "google")?.enabled,
    ).toBe(false);
  });

  it("shows the settings read-only to operators", async () => {
    const server = new FakeAdminServer();
    server.sessionRole = "OPERATOR";
    vi.stubGlobal("fetch", server.fetchImpl);
    renderOauthSettings();

    await screen.findByTestId("admin-oauth-callback-google");
    expect(screen.getByText(t("admin.oauth.readonly"))).toBeTruthy();
    expect(screen.queryByTestId("admin-oauth-save-google")).toBeNull();
  });
});
