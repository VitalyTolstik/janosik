import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUserDto } from "@janosik/shared";

import { api } from "@/api/client";
import { AuthContext, type AuthValue } from "@/auth/AuthContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { I18nProvider } from "@/i18n";
import { defaultI18n } from "@/i18n/i18n";
import * as i18nModule from "@/i18n/i18n";

/**
 * Language switcher (L27/M39): a catalog is loaded before the UI changes, a
 * successful signed-in choice persists to the server profile, and the
 * one-shot `?lng=` handoff is consumed with `history.replaceState` so a dirty
 * workflow draft never sees a router navigation.
 */

const user: AuthUserDto = {
  id: "user-1",
  email: "user@example.com",
  displayName: "User",
  avatarColor: null,
  avatarPath: null,
  locale: "en",
  createdAt: 1,
};

function renderSwitcher(
  path = "/board/b-1",
  options: { updateUser?: (next: AuthUserDto) => void } = {},
) {
  window.history.replaceState({}, "", path);
  const updateUser = options.updateUser ?? vi.fn();
  const auth: AuthValue = {
    status: "authenticated",
    user,
    login: async () => {},
    register: async () => {},
    updateUser,
    logout: async () => {},
    impersonating: false,
  };
  render(
    <AuthContext.Provider value={auth}>
      <I18nProvider>
        <LanguageSwitcher variant="row" />
      </I18nProvider>
    </AuthContext.Provider>,
  );
  return { updateUser };
}

async function chooseLanguage(name: "English" | "Русский") {
  await userEvent.click(screen.getByTestId("pref-language"));
  await userEvent.click(await screen.findByText(name));
}

describe("LanguageSwitcher", () => {
  beforeEach(async () => {
    await defaultI18n.changeLanguage("en");
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("persists a signed-in choice through updateProfile({ locale })", async () => {
    const updated = { ...user, locale: "ru" as const };
    const updateProfile = vi
      .spyOn(api, "updateProfile")
      .mockResolvedValue(updated);
    const { updateUser } = renderSwitcher();

    await chooseLanguage("Русский");

    await waitFor(() =>
      expect(updateProfile).toHaveBeenCalledWith({ locale: "ru" }),
    );
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith(updated));
    expect(defaultI18n.language).toBe("ru");
    expect(localStorage.getItem("janosik-lang")).toBe("ru");
  });

  it("consumes ?lng= without a router navigation and preserves query/hash", async () => {
    renderSwitcher("/board/b-1?lng=ru&keep=1#details");

    await chooseLanguage("Русский");

    await waitFor(() => expect(window.location.pathname).toBe("/board/b-1"));
    expect(window.location.search).toBe("?keep=1");
    expect(window.location.hash).toBe("#details");
    expect(defaultI18n.language).toBe("ru");
  });

  it("keeps ?lng= when the lazy catalog fails to load", async () => {
    const ensureLocale = vi
      .spyOn(i18nModule, "ensureLocale")
      .mockResolvedValue(false);
    const updateProfile = vi.spyOn(api, "updateProfile");
    renderSwitcher("/board/b-1?lng=ru&keep=1#details");

    await chooseLanguage("Русский");

    await waitFor(() => expect(ensureLocale).toHaveBeenCalledWith("ru"));
    expect(window.location.search).toBe("?lng=ru&keep=1");
    expect(defaultI18n.language).toBe("en");
    expect(updateProfile).not.toHaveBeenCalled();
  });
});
