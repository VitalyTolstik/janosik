import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
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

  it("labels database table cells for the phone card layout", async () => {
    const server = new FakeAdminServer();
    server.observability.database.tables = [
      { name: "Board", rows: 12, sizeBytes: 2048 },
    ];
    vi.stubGlobal("fetch", fetchWithManifest(server));
    renderObservability();

    const row = (await screen.findByText("Board")).closest("tr");
    expect(row).not.toBeNull();
    const cells = row?.querySelectorAll("td") ?? [];
    expect(cells).toHaveLength(3);
    expect(cells[0]).toHaveAttribute("data-label", "Table");
    expect(cells[1]).toHaveAttribute("data-label", "Rows");
    expect(cells[2]).toHaveAttribute("data-label", "Size");
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

  it("shows comment-history counts, bytes and every reason without text", async () => {
    const server = new FakeAdminServer();
    server.observability.commentHistory = {
      available: true,
      revisions: { count: 51, bytes: 2_048 },
      activity: { count: 50, bytes: 3_072 },
      derivedTrimmedRevisions: 3,
      incompleteComments: 10,
      reasons: {
        legacy_cutover: 1,
        revision_limit: 2,
        gdpr_erase: 3,
        writer_gap: 4,
      },
      overBudget: { revisions: 2, activity: 1 },
    };
    vi.stubGlobal("fetch", fetchWithManifest(server));
    renderObservability();

    const panel = await screen.findByTestId(
      "admin-observability-comment-history",
    );
    expect(
      within(panel).getByTestId("admin-observability-history-cache"),
    ).toHaveTextContent(t("admin.observability.history.cache"));
    expect(within(panel).getByTestId("history-revisions")).toHaveClass(
      "flex",
      "items-baseline",
      "justify-between",
    );
    expect(
      within(panel).getByTestId("history-revisions").parentElement,
    ).toHaveClass("grid-cols-1", "sm:grid-cols-2");
    const value = (id: string) =>
      within(panel).getByTestId(`${id}-value`).textContent ?? "";
    expect(value("history-revisions")).toBe("51");
    expect(value("history-revision-bytes")).toBe("2.0 KB");
    expect(value("history-activity")).toBe("50");
    expect(value("history-activity-bytes")).toBe("3.0 KB");
    expect(value("history-derived-trims")).toBe("3");
    expect(value("history-incomplete")).toBe("10");
    expect(value("history-over-budget")).toBe("2 / 1");
    expect(value("history-reason-legacy_cutover")).toBe("1");
    expect(value("history-reason-revision_limit")).toBe("2");
    expect(value("history-reason-gdpr_erase")).toBe("3");
    expect(value("history-reason-writer_gap")).toBe("4");
    for (const label of [
      "admin.observability.history.derivedTrims",
      "admin.observability.history.overBudget",
      "admin.observability.history.reason.legacy_cutover",
      "admin.observability.history.reason.revision_limit",
      "admin.observability.history.reason.gdpr_erase",
      "admin.observability.history.reason.writer_gap",
    ] as const) {
      expect(within(panel).getByText(t(label))).toBeVisible();
    }
    expect(panel).not.toHaveTextContent("SECRET COMMENT BODY");
  });

  it("shows unavailable history metrics as dashes, never as zeros", async () => {
    const server = new FakeAdminServer();
    server.observability.commentHistory = {
      available: false,
      revisions: { count: 51, bytes: 2_048 },
      activity: { count: 50, bytes: 3_072 },
      derivedTrimmedRevisions: 3,
      incompleteComments: 10,
      reasons: {
        legacy_cutover: 1,
        revision_limit: 2,
        gdpr_erase: 3,
        writer_gap: 4,
      },
      overBudget: { revisions: 2, activity: 1 },
    };
    vi.stubGlobal("fetch", fetchWithManifest(server));
    renderObservability();

    const panel = await screen.findByTestId(
      "admin-observability-comment-history",
    );
    expect(
      within(panel).getByTestId("admin-observability-history-unavailable"),
    ).toBeVisible();
    for (const id of [
      "history-revisions",
      "history-revision-bytes",
      "history-activity",
      "history-activity-bytes",
      "history-derived-trims",
      "history-incomplete",
      "history-over-budget",
      "history-reason-legacy_cutover",
      "history-reason-revision_limit",
      "history-reason-gdpr_erase",
      "history-reason-writer_gap",
    ]) {
      expect(within(panel).getByTestId(`${id}-value`)).toHaveTextContent("—");
    }
  });
});
