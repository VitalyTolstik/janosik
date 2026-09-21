import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/api/client";
import { AuthProvider } from "@/auth/AuthContext";
import { EmailChangeDialog } from "@/components/account/EmailChangeDialog";
import { ToastProvider } from "@/components/Toast";
import { I18nProvider } from "@/i18n";
import { FakeServer } from "@/test/fake-server";

/**
 * Email change dialog (TASK-51) — the double opt-in the account panel uses:
 * current password + new address, then the 6-digit code from the new inbox.
 */

function renderDialog(server: FakeServer) {
  const onOpenChange = vi.fn();
  vi.stubGlobal("fetch", server.handle);
  render(
    <I18nProvider>
      <ToastProvider>
        <AuthProvider>
          <EmailChangeDialog open onOpenChange={onOpenChange} />
        </AuthProvider>
      </ToastProvider>
    </I18nProvider>,
  );
  return onOpenChange;
}

async function requestCode(server: FakeServer, newEmail = "new@example.com") {
  const onOpenChange = renderDialog(server);
  await userEvent.type(screen.getByTestId("email-change-new"), newEmail);
  await userEvent.type(
    screen.getByTestId("email-change-password"),
    server.account.password,
  );
  await userEvent.click(screen.getByTestId("email-change-send"));
  await waitFor(() => {
    expect(screen.getByTestId("email-change-code")).toBeInTheDocument();
  });
  return onOpenChange;
}

async function typeCode(code: string) {
  const boxes = screen.getAllByRole("textbox");
  expect(boxes).toHaveLength(6);
  // react-otp-input routes keystrokes across the boxes itself; the recorded
  // request body asserts what actually arrived.
  await userEvent.type(boxes[0]!, code);
}

describe("EmailChangeDialog (TASK-51)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
    api.clearAccessToken();
    api.onAuthLost = null;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends the code request with the password and moves to the code step", async () => {
    const server = new FakeServer();
    await requestCode(server);

    expect(server.requests).toContainEqual({
      method: "POST",
      path: "/api/v1/auth/email/change/request",
      body: { newEmail: "new@example.com", currentPassword: "password123" },
    });
  });

  it("confirms the change with the code and closes the dialog", async () => {
    const server = new FakeServer();
    const onOpenChange = await requestCode(server);
    await typeCode(server.emailChangeCode);
    await userEvent.click(screen.getByTestId("email-change-verify"));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(server.requests).toContainEqual({
      method: "POST",
      path: "/api/v1/auth/email/change/confirm",
      body: { code: server.emailChangeCode },
    });
    // The identity really moved: the account email changed server-side.
    expect(server.account.email).toBe("new@example.com");
  });

  it("shows an inline error for a wrong current password and stays open", async () => {
    const server = new FakeServer();
    const onOpenChange = renderDialog(server);
    await userEvent.type(
      screen.getByTestId("email-change-new"),
      "new@example.com",
    );
    await userEvent.type(
      screen.getByTestId("email-change-password"),
      "wrong password",
    );
    await userEvent.click(screen.getByTestId("email-change-send"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Current password is incorrect",
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("shows an inline error for a wrong code and stays on the code step", async () => {
    const server = new FakeServer();
    const onOpenChange = await requestCode(server);
    await typeCode("000000");
    await userEvent.click(screen.getByTestId("email-change-verify"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid or expired code",
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(server.account.email).toBe("admin@example.com");
  });

  it("reports an address that is already registered", async () => {
    const server = new FakeServer();
    renderDialog(server);
    await userEvent.type(
      screen.getByTestId("email-change-new"),
      "taken@example.com",
    );
    await userEvent.type(
      screen.getByTestId("email-change-password"),
      server.account.password,
    );
    await userEvent.click(screen.getByTestId("email-change-send"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This email is already registered",
    );
  });

  it("never sends the request for a malformed address", async () => {
    const server = new FakeServer();
    renderDialog(server);
    await userEvent.type(
      screen.getByTestId("email-change-new"),
      "not-an-email",
    );
    await userEvent.type(
      screen.getByTestId("email-change-password"),
      server.account.password,
    );
    await userEvent.click(screen.getByTestId("email-change-send"));

    // The native email-input validation swallows the submit in the browser
    // (and in jsdom); no code request may leave the client.
    expect(
      server.requests.some(
        (request) => request.path === "/api/v1/auth/email/change/request",
      ),
    ).toBe(false);
  });
});
