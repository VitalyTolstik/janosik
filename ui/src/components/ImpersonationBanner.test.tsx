import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AuthUserDto } from "@janosik/shared";

import { AuthContext, type AuthValue } from "@/auth/AuthContext";
import { ImpersonationBanner } from "@/components/ImpersonationBanner";
import { I18nProvider } from "@/i18n";

const USER: AuthUserDto = {
  id: "u-anna",
  email: "anna@example.com",
  displayName: "Anna",
  avatarColor: null,
  avatarPath: null,
  createdAt: 0,
  emailVerifiedAt: 0,
};

function renderBanner(overrides: Partial<AuthValue> = {}) {
  const exitImpersonation = vi.fn();
  const value: AuthValue = {
    status: "authenticated",
    user: USER,
    login: async () => {},
    register: async () => {},
    updateUser: () => {},
    logout: async () => {},
    registerBeforeLogout: () => () => {},
    impersonating: true,
    exitImpersonation,
    ...overrides,
  };
  render(
    <I18nProvider>
      <AuthContext.Provider value={value}>
        <ImpersonationBanner />
      </AuthContext.Provider>
    </I18nProvider>,
  );
  return { exitImpersonation };
}

describe("ImpersonationBanner", () => {
  it("names the impersonated account and offers the exit action", async () => {
    const { exitImpersonation } = renderBanner();

    const banner = screen.getByTestId("impersonation-banner");
    expect(banner).toHaveAttribute("data-tone", "warning");
    expect(banner).toHaveAttribute("role", "status");
    expect(banner).toHaveTextContent(
      "You are viewing the app as anna@example.com",
    );

    await userEvent.click(screen.getByTestId("impersonation-exit"));
    expect(exitImpersonation).toHaveBeenCalledTimes(1);
  });

  it("cannot be dismissed with a close button", () => {
    renderBanner();

    expect(
      screen.queryByRole("button", { name: /dismiss|close/i }),
    ).not.toBeInTheDocument();
  });

  it("renders nothing outside an impersonation session", () => {
    renderBanner({ impersonating: false });

    expect(
      screen.queryByTestId("impersonation-banner"),
    ).not.toBeInTheDocument();
  });
});
