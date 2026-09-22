import { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/api/client";
import { AuthContext, type AuthValue } from "@/auth/AuthContext";
import { EmailVerificationGate } from "@/components/auth/EmailVerificationGate";
import { I18nProvider } from "@/i18n";
import { FakeServer } from "@/test/fake-server";
import type { AuthUserDto } from "@janosik/shared";

/**
 * Registration email confirmation gate (TASK-53): the fullscreen screen an
 * unconfirmed account sees instead of the boards — code in, account active.
 */

const UNVERIFIED: AuthUserDto = {
  id: "user-1",
  email: "fresh@example.com",
  displayName: "Fresh",
  avatarColor: null,
  avatarPath: null,
  createdAt: Date.UTC(2026, 8, 22),
  emailVerifiedAt: null,
};

function renderGate(server: FakeServer) {
  const updateUser = vi.fn();
  const logout = vi.fn().mockResolvedValue(undefined);
  const value: AuthValue = {
    status: "authenticated",
    user: UNVERIFIED,
    login: vi.fn().mockResolvedValue(undefined),
    register: vi.fn().mockResolvedValue(undefined),
    updateUser,
    logout,
  };
  vi.stubGlobal("fetch", server.handle);
  render(
    <I18nProvider>
      <AuthContext.Provider value={value}>
        <EmailVerificationGate />
      </AuthContext.Provider>
    </I18nProvider>,
  );
  return { updateUser, logout };
}

async function typeCode(code: string) {
  const boxes = screen.getAllByRole("textbox");
  expect(boxes).toHaveLength(6);
  await userEvent.type(boxes[0]!, code);
}

describe("EmailVerificationGate (TASK-53)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
    api.clearAccessToken();
    api.onAuthLost = null;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("activates the account with the code from the email", async () => {
    const server = new FakeServer();
    server.emailVerified = false;
    const { updateUser } = renderGate(server);

    await typeCode(server.emailVerifyCode);
    await userEvent.click(screen.getByTestId("email-verify-verify"));

    await waitFor(() => {
      expect(updateUser).toHaveBeenCalledWith(
        expect.objectContaining({ emailVerifiedAt: expect.any(Number) }),
      );
    });
    expect(server.requests).toContainEqual({
      method: "POST",
      path: "/api/v1/auth/verify-email",
      body: { code: server.emailVerifyCode },
    });
  });

  it("shows an inline error for a wrong code and stays", async () => {
    const server = new FakeServer();
    server.emailVerified = false;
    const { updateUser } = renderGate(server);

    await typeCode("000000");
    await userEvent.click(screen.getByTestId("email-verify-verify"));

    expect(await screen.findByTestId("email-verify-error")).toBeInTheDocument();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("resends the code after the cooldown", async () => {
    vi.useFakeTimers();
    try {
      const server = new FakeServer();
      server.emailVerified = false;
      renderGate(server);

      // Freshly registered: the resend sits behind the 60s cooldown…
      expect(screen.getByTestId("email-verify-resend")).toBeDisabled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });

      const button = screen.getByTestId("email-verify-resend");
      expect(button).toBeEnabled();
      fireEvent.click(button);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(server.requests).toContainEqual({
        method: "POST",
        path: "/api/v1/auth/verify-email/resend",
        body: {},
      });
      // …and goes back behind it right away.
      expect(screen.getByTestId("email-verify-resend")).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("signs out on demand", async () => {
    const server = new FakeServer();
    const { logout } = renderGate(server);

    await userEvent.click(screen.getByTestId("email-verify-signout"));

    await waitFor(() => expect(logout).toHaveBeenCalled());
  });
});
