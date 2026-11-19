import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Link,
  MemoryRouter,
  useLocation,
  useSearchParams,
} from "react-router-dom";
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
 * successful signed-in choice persists to the server profile, and the one-shot
 * `?lng=` handoff is consumed through the router so later URL rebuilds cannot
 * reintroduce it. The workflow blocker (M39) ignores only that change.
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

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
      {location.hash}
    </output>
  );
}

/** A later board-filter/list write that rebuilds from `useSearchParams`. */
function QueryWriter() {
  const [, setParams] = useSearchParams();
  return (
    <button
      type="button"
      data-testid="apply-filter"
      onClick={() =>
        setParams(
          (current) => {
            const next = new URLSearchParams(current);
            next.set("q", "alpha");
            return next;
          },
          { replace: true },
        )
      }
    >
      Apply filter
    </button>
  );
}

/** SPA navigation to a different board while the catalog is still loading. */
function BoardTwoLink() {
  return (
    <Link data-testid="go-board-two" to="/board/b-2?card=c-1&lng=ru#details">
      Board two
    </Link>
  );
}

function renderSwitcher(
  path = "/board/b-1",
  options: { updateUser?: (next: AuthUserDto) => void } = {},
) {
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
        <MemoryRouter initialEntries={[path]}>
          <LanguageSwitcher variant="row" />
          <LocationProbe />
          <QueryWriter />
          <BoardTwoLink />
        </MemoryRouter>
      </I18nProvider>
    </AuthContext.Provider>,
  );
  return { updateUser };
}

function locationText(): string {
  return screen.getByTestId("location").textContent ?? "";
}

async function chooseLanguage(name: "English" | "Русский") {
  await userEvent.click(screen.getByTestId("pref-language"));
  await userEvent.click(await screen.findByText(name));
}

describe("LanguageSwitcher", () => {
  beforeEach(async () => {
    await defaultI18n.changeLanguage("en");
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

  it("consumes ?lng= through the router and keeps later query writes clean", async () => {
    renderSwitcher("/board/b-1?lng=ru&keep=1#details");

    await chooseLanguage("Русский");

    await waitFor(() =>
      expect(locationText()).toBe("/board/b-1?keep=1#details"),
    );
    expect(locationText()).not.toContain("lng=");
    expect(defaultI18n.language).toBe("ru");
    expect(localStorage.getItem("janosik-lang")).toBe("ru");

    // The board filter/admin list rebuild their URL from useSearchParams.
    // A stale router location would carry `lng` back into the new URL.
    await userEvent.click(screen.getByTestId("apply-filter"));
    await waitFor(() =>
      expect(locationText()).toBe("/board/b-1?keep=1&q=alpha"),
    );
    expect(locationText()).not.toContain("lng=");
  });

  it("cleans lng from the latest location after navigation during the load", async () => {
    let resolveEnsure!: (ready: boolean) => void;
    vi.spyOn(i18nModule, "ensureLocale").mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveEnsure = resolve;
      }),
    );
    renderSwitcher("/board/b-1?lng=ru&keep=1#details");

    await chooseLanguage("Русский");
    expect(locationText()).toBe("/board/b-1?lng=ru&keep=1#details");

    // Filter first, then switch boards elsewhere while the catalog is still
    // loading. Both newer URLs carry the old `lng` for this stress case.
    await userEvent.click(screen.getByTestId("apply-filter"));
    await waitFor(() =>
      expect(locationText()).toBe("/board/b-1?lng=ru&keep=1&q=alpha"),
    );
    await userEvent.click(screen.getByTestId("go-board-two"));
    await waitFor(() =>
      expect(locationText()).toBe("/board/b-2?card=c-1&lng=ru#details"),
    );

    await act(async () => {
      resolveEnsure(true);
      await Promise.resolve();
    });

    // The cleanup edits the location the user is on now; it must not navigate
    // back to the click-time board/filter snapshot.
    await waitFor(() =>
      expect(locationText()).toBe("/board/b-2?card=c-1#details"),
    );
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
    expect(locationText()).toBe("/board/b-1?lng=ru&keep=1#details");
    expect(defaultI18n.language).toBe("en");
    expect(updateProfile).not.toHaveBeenCalled();
  });
});
