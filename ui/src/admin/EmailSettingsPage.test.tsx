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
 * Email service page (TASK-52) against the in-memory fake admin API:
 * bootstrap status, preset switching, the owner save flow and the probe.
 */

const t = (
  key: Parameters<typeof adminMessage>[0],
  params?: Record<string, string | number>,
) => adminMessage(key, "en", params);

function renderEmailSettings() {
  return render(
    <I18nProvider>
      <ToastProvider>
        <TooltipProvider>
          <MemoryRouter initialEntries={["/admin/email"]}>
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

describe("EmailSettingsPage", () => {
  it("renders the bootstrap status and every provider preset", async () => {
    const server = new FakeAdminServer();
    vi.stubGlobal("fetch", server.fetchImpl);
    renderEmailSettings();

    expect(await screen.findByText(t("admin.email.status.log"))).toBeTruthy();
    for (const id of [
      "gmail",
      "yandex",
      "mailru",
      "brevo",
      "sendgrid",
      "custom",
      "mailpit",
    ]) {
      expect(screen.getByTestId(`admin-email-preset-${id}`)).toBeTruthy();
    }
  });

  it("saving with the sandbox preset needs no credentials and shows the local inbox", async () => {
    const server = new FakeAdminServer();
    vi.stubGlobal("fetch", server.fetchImpl);
    renderEmailSettings();

    await screen.findByText(t("admin.email.status.log"));
    fireEvent.click(screen.getByTestId("admin-email-preset-mailpit"));
    // The sandbox needs no credentials: no username field, save is enabled.
    expect(screen.queryByTestId("admin-email-username")).toBeNull();
    const save = screen.getByTestId("admin-email-save") as HTMLButtonElement;
    expect(save.disabled).toBe(false);

    fireEvent.click(save);

    const inbox = await screen.findByTestId("admin-email-webviewer");
    const link = inbox.querySelector("a") as HTMLAnchorElement;
    expect(link.href).toContain("localhost:8025");
    expect(server.emailSettings).toMatchObject({
      provider: "mailpit",
      username: "",
      enabled: false,
      active: false,
    });
  });

  it("switching to a preset fills its connection settings and saving activates delivery", async () => {
    const server = new FakeAdminServer();
    vi.stubGlobal("fetch", server.fetchImpl);
    renderEmailSettings();

    await screen.findByText(t("admin.email.status.log"));
    fireEvent.click(screen.getByTestId("admin-email-preset-gmail"));
    expect(
      (screen.getByTestId("admin-email-username") as HTMLInputElement)
        .placeholder,
    ).toBe("you@gmail.com");

    fireEvent.change(screen.getByTestId("admin-email-from"), {
      target: { value: "Janosik <no-reply@example.com>" },
    });
    fireEvent.change(screen.getByTestId("admin-email-username"), {
      target: { value: "you@gmail.com" },
    });
    fireEvent.change(screen.getByTestId("admin-email-password"), {
      target: { value: "sixteen-char-app-password" },
    });
    fireEvent.click(screen.getByTestId("admin-email-enabled"));
    fireEvent.click(screen.getByTestId("admin-email-save"));

    await screen.findByText(
      t("admin.email.status.on")
        .replace("{provider}", "Gmail")
        .replace("{host}", "smtp.gmail.com")
        .replace("{port}", "465"),
    );

    const put = [...server.requests]
      .reverse()
      .find(
        (request) =>
          request.method === "PUT" && request.path === "/admin/email-settings",
      );
    expect(put?.body).toMatchObject({
      provider: "gmail",
      username: "you@gmail.com",
      password: "sixteen-char-app-password",
      enabled: true,
    });
    expect(server.emailSettings.active).toBe(true);
    expect(server.emailSettings.hasPassword).toBe(true);
  });

  it("sends a probe email from the test section", async () => {
    const server = new FakeAdminServer();
    vi.stubGlobal("fetch", server.fetchImpl);
    renderEmailSettings();

    await screen.findByText(t("admin.email.status.log"));
    fireEvent.change(screen.getByTestId("admin-email-test-to"), {
      target: { value: "owner@example.com" },
    });
    fireEvent.click(screen.getByTestId("admin-email-test-send"));

    await waitFor(() => {
      expect(screen.getByTestId("admin-email-test-ok")).toBeTruthy();
    });
    const probe = [...server.requests]
      .reverse()
      .find((request) => request.path === "/admin/email-settings/test");
    expect(probe?.body).toEqual({ to: "owner@example.com" });
  });

  it("operators see the page read-only", async () => {
    const server = new FakeAdminServer();
    server.sessionRole = "OPERATOR";
    vi.stubGlobal("fetch", server.fetchImpl);
    renderEmailSettings();

    await screen.findByText(t("admin.email.readonly"));
    expect(screen.queryByTestId("admin-email-save")).toBeNull();
    expect(
      (screen.getByTestId("admin-email-test-send") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("admin-email-username") as HTMLInputElement).disabled,
    ).toBe(true);
  });
});
