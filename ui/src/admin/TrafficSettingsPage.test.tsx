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
 * Traffic & limits page (TASK-57) against the fake admin API: the live gauge,
 * the owner edit flow (applies immediately) and the operator read-only view.
 */

const t = (
  key: Parameters<typeof adminMessage>[0],
  params?: Record<string, string | number>,
) => adminMessage(key, "en", params);

function renderTraffic() {
  return render(
    <I18nProvider>
      <ToastProvider>
        <TooltipProvider>
          <MemoryRouter initialEntries={["/admin/traffic"]}>
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

describe("TrafficSettingsPage", () => {
  it("shows the live gauge and the current limit", async () => {
    const server = new FakeAdminServer();
    vi.stubGlobal("fetch", server.fetchImpl);
    renderTraffic();

    expect(await screen.findByTestId("admin-traffic-rpm")).toHaveTextContent(
      "15",
    );
    expect(screen.getByTestId("admin-traffic-throttled")).toHaveTextContent(
      "0",
    );
    expect(screen.getByTestId("admin-traffic-limit")).toHaveTextContent("300");
    expect(screen.getByText(t("admin.traffic.limitSource.env"))).toBeTruthy();
  });

  it("lets the owner raise the limit, applying it to the gauge", async () => {
    const server = new FakeAdminServer();
    vi.stubGlobal("fetch", server.fetchImpl);
    renderTraffic();

    const input = (await screen.findByTestId(
      "admin-traffic-limit-input",
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "900" } });
    fireEvent.click(screen.getByTestId("admin-traffic-save"));

    await waitFor(() => expect(server.throttleSettings.limit).toBe(900));
    await waitFor(() =>
      expect(screen.getByTestId("admin-traffic-limit")).toHaveTextContent(
        "900",
      ),
    );
    const put = server.requests.find(
      (call) =>
        call.method === "PUT" && call.path === "/admin/throttle-settings",
    );
    expect(put?.body).toEqual({ limit: 900 });
  });

  it("shows the limit read-only to operators", async () => {
    const server = new FakeAdminServer();
    server.sessionRole = "OPERATOR";
    vi.stubGlobal("fetch", server.fetchImpl);
    renderTraffic();

    await screen.findByTestId("admin-traffic-rpm");
    expect(screen.getByText(t("admin.traffic.readonly"))).toBeTruthy();
    expect(screen.queryByTestId("admin-traffic-save")).toBeNull();
  });
});
