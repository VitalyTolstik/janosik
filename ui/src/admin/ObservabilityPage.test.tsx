import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { I18nProvider } from "@/i18n";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { resetAppVersionCache } from "@/utils/app-version";
import { adminApi } from "./admin-client";
import AdminApp from "./AdminApp";
import { adminMessage } from "./admin-i18n";
import { FakeAdminServer } from "./test/fake-admin-server";

/**
 * Observability page (TASK-64) — the backend snapshot plus the frontend
 * panel that describes the build of the UI serving the panel.
 */

const t = (key: Parameters<typeof adminMessage>[0]) => adminMessage(key, "en");

function renderObservability() {
  return render(
    <ThemeProvider>
      <I18nProvider>
        <ToastProvider>
          <TooltipProvider>
            <MemoryRouter initialEntries={["/admin/observability"]}>
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

/** The fake API plus the build manifest the frontend panel fetches. */
function fetchWithManifest(server: FakeAdminServer): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/version.json")) {
      return new Response(
        JSON.stringify({
          version: "9.9.9",
          commit: "abc1234",
          build: "janosik-deadbeef",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return server.fetchImpl(input, init);
  }) as typeof fetch;
}

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
  adminApi.clearAccessToken();
  adminApi.onAuthLost = null;
  resetAppVersionCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetAppVersionCache();
});

describe("ObservabilityPage", () => {
  it("shows the frontend build next to the backend runtime", async () => {
    vi.stubGlobal("fetch", fetchWithManifest(new FakeAdminServer()));
    renderObservability();

    // Backend runtime panel (from the API)…
    expect(
      await screen.findByText(t("admin.observability.health")),
    ).toBeTruthy();
    // …and the frontend panel (from version.json).
    expect(await screen.findByText("9.9.9")).toBeTruthy();
    expect(screen.getByText("janosik-deadbeef")).toBeTruthy();
    expect(screen.getByText("abc1234")).toBeTruthy();
  });

  it("reports the theme and the (unsupported) service worker state", async () => {
    vi.stubGlobal("fetch", fetchWithManifest(new FakeAdminServer()));
    renderObservability();

    // jsdom has no service worker API and defaults to the light theme.
    expect(
      await screen.findByText(t("admin.observability.frontend.theme.light")),
    ).toBeTruthy();
    expect(
      screen.getByText(t("admin.observability.frontend.sw.unsupported")),
    ).toBeTruthy();
    expect(
      screen.getByText(t("admin.observability.frontend.connection.online")),
    ).toBeTruthy();
  });

  it("degrades to dashes when the manifest is missing", async () => {
    const server = new FakeAdminServer();
    vi.stubGlobal("fetch", (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/version.json")) {
        return new Response("", { status: 404 });
      }
      return server.fetchImpl(input, init);
    }) as typeof fetch);
    renderObservability();

    const panel = await screen.findByTestId("admin-observability-frontend");
    expect(panel).toHaveTextContent(t("admin.observability.frontend.build"));
    expect(await screen.findAllByText("—")).not.toHaveLength(0);
  });
});
