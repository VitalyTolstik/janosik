import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import { AuthContext, type AuthValue } from "@/auth/AuthContext";
import { I18nProvider } from "@/i18n";

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

function renderBanner() {
  return render(
    <I18nProvider>
      <AuthContext.Provider value={AUTH}>
        <AnnouncementBanner />
      </AuthContext.Provider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  activeAnnouncements.mockReset();
  localStorage.clear();
});

describe("AnnouncementBanner", () => {
  it("maps announcement levels onto info, warning and danger tones", async () => {
    activeAnnouncements.mockResolvedValue([
      { id: "a-info", title: "Info", body: "Info body", level: "info" },
      {
        id: "a-warning",
        title: "Warning",
        body: "Warning body",
        level: "warning",
      },
      { id: "a-danger", title: "Danger", body: "Danger body", level: "danger" },
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

  it("dismisses one announcement and remembers it in localStorage", async () => {
    activeAnnouncements.mockResolvedValue([
      { id: "a-1", title: "Maintenance", body: "Tonight", level: "info" },
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
      { id: "a-1", title: "Old news", body: "", level: "info" },
      { id: "a-2", title: "Fresh news", body: "", level: "info" },
    ]);

    renderBanner();

    expect(await screen.findByText("Fresh news")).toBeInTheDocument();
    expect(screen.queryByText("Old news")).not.toBeInTheDocument();
  });
});
