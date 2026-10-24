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
 * Demo runner page (TASK-57) against the fake admin API: start seeds the
 * counters, stop confirms and flips the state, and operators see it read-only.
 */

const t = (
  key: Parameters<typeof adminMessage>[0],
  params?: Record<string, string | number>,
) => adminMessage(key, "en", params);

function renderDemo() {
  return render(
    <I18nProvider>
      <ToastProvider>
        <TooltipProvider>
          <MemoryRouter initialEntries={["/admin/demo"]}>
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

describe("DemoPage", () => {
  it("starts a demo and reflects the seed counts", async () => {
    const server = new FakeAdminServer();
    vi.stubGlobal("fetch", server.fetchImpl);
    renderDemo();

    expect(await screen.findByTestId("admin-demo-status")).toHaveTextContent(
      t("admin.demo.idle"),
    );

    fireEvent.change(screen.getByTestId("admin-demo-agents-input"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByTestId("admin-demo-cards-input"), {
      target: { value: "8" },
    });
    fireEvent.click(screen.getByTestId("admin-demo-start"));

    await waitFor(() =>
      expect(screen.getByTestId("admin-demo-status")).toHaveTextContent(
        t("admin.demo.running"),
      ),
    );
    expect(screen.getByTestId("admin-demo-agents")).toHaveTextContent("4");
    // Tasks are independent of the agent count.
    expect(screen.getByTestId("admin-demo-cards")).toHaveTextContent("8");
    expect(server.demoStatus.running).toBe(true);
  });

  it("binds the demo to a saved board id (Save shows it above)", async () => {
    const server = new FakeAdminServer();
    vi.stubGlobal("fetch", server.fetchImpl);
    renderDemo();

    fireEvent.change(await screen.findByTestId("admin-demo-board-input"), {
      target: { value: "board-xyz" },
    });
    fireEvent.click(screen.getByTestId("admin-demo-board-save"));
    // The board panel above reflects the saved selection.
    expect(screen.getByTestId("admin-demo-board")).toHaveTextContent(
      "board-xyz",
    );

    fireEvent.change(screen.getByTestId("admin-demo-agents-input"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByTestId("admin-demo-cards-input"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByTestId("admin-demo-start"));

    await waitFor(() => expect(server.demoStatus.running).toBe(true));
    const call = server.requests.find(
      (item) => item.method === "POST" && item.path === "/admin/demo/start",
    );
    expect(call?.body).toMatchObject({
      users: 2,
      cards: 2,
      boardId: "board-xyz",
    });
  });

  it("stops the demo after confirmation", async () => {
    const server = new FakeAdminServer();
    server.demoStatus = {
      running: true,
      boardId: "demo-board",
      startedAt: new Date().toISOString(),
      users: 4,
      columns: 5,
      labels: 5,
      cards: 3,
      cardsDone: 1,
      cleanupPending: true,
    };
    vi.stubGlobal("fetch", server.fetchImpl);
    renderDemo();

    fireEvent.click(await screen.findByTestId("admin-demo-stop"));
    fireEvent.click(screen.getByTestId("admin-confirm-accept"));

    await waitFor(() => expect(server.demoStatus.running).toBe(false));
    await waitFor(() =>
      expect(screen.getByTestId("admin-demo-status")).toHaveTextContent(
        t("admin.demo.idle"),
      ),
    );
  });

  it("keeps clean-up available after the swarm finished", async () => {
    const server = new FakeAdminServer();
    server.demoStatus = {
      running: false,
      boardId: "demo-board",
      startedAt: new Date().toISOString(),
      users: 4,
      columns: 5,
      labels: 5,
      cards: 8,
      cardsDone: 8,
      cleanupPending: true,
    };
    vi.stubGlobal("fetch", server.fetchImpl);
    renderDemo();

    const stop = await screen.findByTestId("admin-demo-stop");
    expect(stop).not.toBeDisabled();
    expect(screen.getByTestId("admin-demo-status")).toHaveTextContent(
      t("admin.demo.idle"),
    );
  });

  it("shows the runner read-only to operators", async () => {
    const server = new FakeAdminServer();
    server.sessionRole = "OPERATOR";
    vi.stubGlobal("fetch", server.fetchImpl);
    renderDemo();

    await screen.findByTestId("admin-demo-status");
    expect(screen.getByText(t("admin.demo.readonly"))).toBeTruthy();
    expect(screen.queryByTestId("admin-demo-start")).toBeNull();
    expect(screen.queryByTestId("admin-demo-stop")).toBeNull();
  });
});
