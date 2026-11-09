import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import { AuthContext, type AuthValue } from "@/auth/AuthContext";
import { I18nProvider } from "@/i18n";
import { defaultI18n } from "@/i18n/i18n";

const { activeAnnouncements } = vi.hoisted(() => ({
  activeAnnouncements: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  isApiEnabled: () => true,
  api: { activeAnnouncements },
}));

const AUTH: AuthValue = {
  status: "authenticated",
  user: null,
  login: async () => {},
  register: async () => {},
  updateUser: () => {},
  logout: async () => {},
  registerBeforeLogout: () => () => {},
  impersonating: false,
  exitImpersonation: () => {},
};

function announcement(
  overrides: Partial<{
    id: string;
    title: string;
    body: string;
    level: "info" | "warning" | "danger";
    contentLocale: "en" | "ru" | null;
    requestedLocale: "en" | "ru";
    isFallback: boolean;
  }> = {},
) {
  return {
    id: "a-1",
    title: "Maintenance",
    body: "Tonight",
    level: "info" as const,
    contentLocale: "en" as const,
    requestedLocale: "en" as const,
    isFallback: false,
    ...overrides,
  };
}

function renderBanner() {
  return render(
    <I18nProvider>
      <AuthContext.Provider value={AUTH}>
        <AnnouncementBanner />
      </AuthContext.Provider>
    </I18nProvider>,
  );
}

beforeEach(async () => {
  activeAnnouncements.mockReset();
  localStorage.clear();
  await defaultI18n.changeLanguage("en");
});

afterEach(async () => {
  await defaultI18n.changeLanguage("en");
});

describe("AnnouncementBanner", () => {
  it("maps announcement levels onto info, warning and danger tones", async () => {
    activeAnnouncements.mockResolvedValue([
      announcement({ id: "a-info", title: "Info", body: "Info body" }),
      announcement({
        id: "a-warning",
        title: "Warning",
        body: "Warning body",
        level: "warning",
      }),
      announcement({
        id: "a-danger",
        title: "Danger",
        body: "Danger body",
        level: "danger",
      }),
    ]);

    renderBanner();

    const banner = await screen.findByTestId("announcement-banner");
    expect(banner.querySelector('[data-tone="info"]')).toHaveTextContent(
      "Info",
    );
    expect(banner.querySelector('[data-tone="warning"]')).toHaveTextContent(
      "Warning",
    );
    expect(banner.querySelector('[data-tone="danger"]')).toHaveTextContent(
      "Danger",
    );
    // Warnings and errors interrupt; the info card is a polite status.
    expect(within(banner).getAllByRole("alert")).toHaveLength(2);
    expect(within(banner).getAllByRole("status")).toHaveLength(1);
  });

  it("shows the localized fallback notice and tags the content language", async () => {
    activeAnnouncements.mockResolvedValue([
      announcement({
        id: "a-ru",
        title: "Плановые работы",
        body: "Сервер недоступен",
        contentLocale: "ru",
        requestedLocale: "en",
        isFallback: true,
      }),
    ]);

    renderBanner();

    const notice = await screen.findByTestId("announcement-fallback-a-ru");
    expect(notice).toHaveTextContent(
      "This announcement is available in Russian only.",
    );
    expect(notice).toHaveAttribute("lang", "en");
    expect(screen.getByText("Плановые работы")).toHaveAttribute("lang", "ru");
    expect(screen.getByText("Сервер недоступен")).toHaveAttribute("lang", "ru");
  });

  it("does not show a notice when the viewer's language is exact", async () => {
    activeAnnouncements.mockResolvedValue([
      announcement({
        id: "a-ru",
        title: "Плановые работы",
        body: "Сервер недоступен",
        contentLocale: "ru",
        requestedLocale: "ru",
        isFallback: false,
      }),
    ]);

    renderBanner();

    await screen.findByText("Плановые работы");
    expect(screen.queryByTestId("announcement-fallback-a-ru")).toBeNull();
    expect(screen.getByText("Плановые работы")).toHaveAttribute("lang", "ru");
  });

  it("refetches in the new language when the interface language changes", async () => {
    activeAnnouncements.mockResolvedValue([
      announcement({ id: "a-1", title: "English" }),
    ]);

    renderBanner();
    await screen.findByText("English");
    expect(activeAnnouncements).toHaveBeenCalledWith("en");

    activeAnnouncements.mockResolvedValue([
      announcement({
        id: "a-1",
        title: "Русский",
        contentLocale: "ru",
        requestedLocale: "ru",
      }),
    ]);
    await act(async () => {
      await defaultI18n.changeLanguage("ru");
    });

    expect(await screen.findByText("Русский")).toBeInTheDocument();
    expect(activeAnnouncements).toHaveBeenCalledWith("ru");
  });

  it("hides stale items when the language changes and the refetch fails", async () => {
    activeAnnouncements.mockResolvedValueOnce([
      announcement({ id: "a-1", title: "English" }),
    ]);
    renderBanner();
    await screen.findByText("English");

    activeAnnouncements.mockRejectedValueOnce(new Error("offline"));
    activeAnnouncements.mockResolvedValue([]);
    await act(async () => {
      await defaultI18n.changeLanguage("ru");
    });

    expect(screen.queryByText("English")).not.toBeInTheDocument();
  });

  it("dismisses one announcement and remembers it in localStorage", async () => {
    activeAnnouncements.mockResolvedValue([
      announcement({ id: "a-1", title: "Maintenance", body: "Tonight" }),
    ]);

    renderBanner();

    expect(await screen.findByText("Maintenance")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("announcement-dismiss-a-1"));

    expect(screen.queryByText("Maintenance")).not.toBeInTheDocument();
    expect(localStorage.getItem("janosik.announcements.dismissed")).toBe(
      '["a-1"]',
    );
  });

  it("does not show previously dismissed announcements", async () => {
    localStorage.setItem("janosik.announcements.dismissed", '["a-1"]');
    activeAnnouncements.mockResolvedValue([
      announcement({ id: "a-1", title: "Old news", body: "" }),
      announcement({ id: "a-2", title: "Fresh news", body: "" }),
    ]);

    renderBanner();

    expect(await screen.findByText("Fresh news")).toBeInTheDocument();
    expect(screen.queryByText("Old news")).not.toBeInTheDocument();
  });

  it("keeps a dismissed announcement hidden after a language switch", async () => {
    activeAnnouncements.mockResolvedValue([
      announcement({ id: "a-1", title: "English" }),
    ]);
    renderBanner();
    await screen.findByText("English");
    await userEvent.click(screen.getByTestId("announcement-dismiss-a-1"));

    activeAnnouncements.mockResolvedValue([
      announcement({
        id: "a-1",
        title: "Русский",
        contentLocale: "ru",
        requestedLocale: "ru",
      }),
    ]);
    await act(async () => {
      await defaultI18n.changeLanguage("ru");
    });
    await waitFor(() => expect(activeAnnouncements).toHaveBeenCalledWith("ru"));
    expect(screen.queryByText("Русский")).not.toBeInTheDocument();
  });
});
