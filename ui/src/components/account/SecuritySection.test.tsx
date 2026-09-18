import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/api/client";
import { SecuritySection } from "@/components/account/SecuritySection";
import { ToastProvider } from "@/components/Toast";
import { I18nProvider } from "@/i18n";
import { FakeServer } from "@/test/fake-server";

/**
 * Security section (TASK-36.1): password rotation proves the current
 * password, validates the new one client-side and reports the server's 401
 * verbatim ("current password is incorrect") without leaking anything else.
 */

function renderSecurity(server: FakeServer) {
  vi.stubGlobal("fetch", server.handle);
  return render(
    <I18nProvider>
      <ToastProvider>
        <SecuritySection />
      </ToastProvider>
    </I18nProvider>,
  );
}

describe("SecuritySection (TASK-36.1)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
    api.clearAccessToken();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("validates length and confirmation before hitting the API", async () => {
    const server = new FakeServer();
    renderSecurity(server);

    const submit = screen.getByTestId("security-submit");
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByTestId("security-current"), "password123");
    await userEvent.type(screen.getByTestId("security-new"), "short");
    expect(await screen.findByTestId("security-error")).toHaveTextContent(
      "at least 8 characters",
    );
    expect(submit).toBeDisabled();

    await userEvent.clear(screen.getByTestId("security-new"));
    await userEvent.type(screen.getByTestId("security-new"), "long enough 1");
    await userEvent.type(screen.getByTestId("security-confirm"), "different 2");
    expect(screen.getByTestId("security-error")).toHaveTextContent(
      "Passwords do not match",
    );
    expect(submit).toBeDisabled();

    await userEvent.clear(screen.getByTestId("security-confirm"));
    await userEvent.type(
      screen.getByTestId("security-confirm"),
      "long enough 1",
    );
    expect(submit).toBeEnabled();
  });

  it("reports a wrong current password and keeps the input", async () => {
    const server = new FakeServer();
    renderSecurity(server);

    await userEvent.type(screen.getByTestId("security-current"), "wrong pass");
    await userEvent.type(screen.getByTestId("security-new"), "long enough 1");
    await userEvent.type(
      screen.getByTestId("security-confirm"),
      "long enough 1",
    );
    await userEvent.click(screen.getByTestId("security-submit"));

    expect(await screen.findByTestId("security-error")).toHaveTextContent(
      "Current password is incorrect",
    );
    expect(screen.getByTestId("security-current")).toHaveValue("wrong pass");
    expect(server.account.password).toBe("password123");
  });

  it("rotates the password, clears the form and toasts", async () => {
    const server = new FakeServer();
    renderSecurity(server);

    await userEvent.type(screen.getByTestId("security-current"), "password123");
    await userEvent.type(screen.getByTestId("security-new"), "brand new pass");
    await userEvent.type(
      screen.getByTestId("security-confirm"),
      "brand new pass",
    );
    await userEvent.click(screen.getByTestId("security-submit"));

    await waitFor(() =>
      expect(server.requests).toContainEqual({
        method: "POST",
        path: "/api/v1/auth/password",
        body: {
          currentPassword: "password123",
          newPassword: "brand new pass",
        },
      }),
    );
    expect(server.account.password).toBe("brand new pass");
    expect(await screen.findByText(/Password changed/)).toBeInTheDocument();
    expect(screen.getByTestId("security-current")).toHaveValue("");
  });

  it("toggles password visibility", async () => {
    const server = new FakeServer();
    renderSecurity(server);

    const input = screen.getByTestId("security-current");
    expect(input).toHaveAttribute("type", "password");
    await userEvent.click(screen.getByTestId("security-current-toggle"));
    expect(input).toHaveAttribute("type", "text");
  });
});
