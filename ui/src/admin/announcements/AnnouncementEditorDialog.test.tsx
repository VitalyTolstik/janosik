import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AdminAnnouncementDto } from "@janosik/shared";

import { I18nProvider } from "@/i18n";
import { ToastProvider } from "@/components/Toast";
import { ThemeProvider } from "@/hooks/use-theme";
import { adminApi } from "../admin-client";
import { AnnouncementEditorDialog } from "./AnnouncementEditorDialog";
import { FakeAdminServer } from "../test/fake-admin-server";

function renderEditor(options: {
  announcement?: AdminAnnouncementDto;
  onDone?: () => void;
  readOnly?: boolean;
}) {
  return render(
    <ThemeProvider>
      <I18nProvider>
        <ToastProvider>
          <AnnouncementEditorDialog
            announcement={options.announcement}
            readOnly={options.readOnly}
            onClose={() => undefined}
            onDone={options.onDone ?? (() => undefined)}
          />
        </ToastProvider>
      </I18nProvider>
    </ThemeProvider>,
  );
}

function fillRu(title: string, body: string) {
  fireEvent.click(screen.getByTestId("announcement-tab-ru"));
  fireEvent.change(screen.getByTestId("admin-announcement-title-ru"), {
    target: { value: title },
  });
  fireEvent.change(screen.getByTestId("admin-announcement-body-ru"), {
    target: { value: body },
  });
}

function announcement(
  overrides: Partial<AdminAnnouncementDto> = {},
): AdminAnnouncementDto {
  return {
    id: "ann-1",
    title: "Maintenance",
    body: "Tonight",
    sourceLocale: "en",
    fallbackPolicy: "require_all",
    translations: [
      {
        locale: "en",
        title: "Maintenance",
        body: "Tonight",
        origin: "human",
        translatedFrom: null,
        sourceUpdatedAt: null,
        reviewedAt: 1,
        updatedAt: 1,
        updatedBy: "master@example.com",
      },
      {
        locale: "ru",
        title: "Работы",
        body: "Сегодня",
        origin: "human",
        translatedFrom: "en",
        sourceUpdatedAt: null,
        reviewedAt: 1,
        updatedAt: 1,
        updatedBy: "master@example.com",
      },
    ],
    completeness: { en: true, ru: true },
    level: "info",
    audience: "all",
    segment: null,
    active: true,
    sendEmail: false,
    emailSentAt: null,
    startsAt: null,
    endsAt: null,
    version: 1,
    createdBy: "master@example.com",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
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

describe("AnnouncementEditorDialog", () => {
  it("blocks strict publication with only RU and allows a draft", async () => {
    const server = new FakeAdminServer();
    vi.stubGlobal("fetch", server.fetchImpl);
    renderEditor({});

    fillRu("Плановые работы", "Сервер недоступен");

    const publish = screen.getByTestId(
      "admin-announcement-publish",
    ) as HTMLButtonElement;
    const draft = screen.getByTestId(
      "admin-announcement-save-draft",
    ) as HTMLButtonElement;
    expect(screen.getByTestId("announcement-status-en")).toHaveTextContent(
      "Not filled",
    );
    expect(screen.getByTestId("announcement-status-ru")).toHaveTextContent(
      "Ready",
    );
    expect(publish.disabled).toBe(true);
    expect(draft.disabled).toBe(false);

    fireEvent.click(draft);
    await waitFor(() => expect(server.requests.length).toBeGreaterThan(0));
    const post = server.requests.find(
      (request) =>
        request.method === "POST" && request.path === "/admin/announcements",
    );
    expect(post?.body).toMatchObject({
      active: false,
      sourceLocale: "ru",
      translations: { ru: { title: "Плановые работы" } },
    });
  });

  it("previews the fallback and publishes a single-language announcement", async () => {
    const server = new FakeAdminServer();
    vi.stubGlobal("fetch", server.fetchImpl);
    const onDone = vi.fn();
    renderEditor({ onDone });

    fillRu("Плановые работы", "Сервер недоступен");
    fireEvent.click(screen.getByTestId("announcement-policy-allow_fallback"));

    expect(
      await screen.findByText(
        "This announcement is available in Russian only.",
      ),
    ).toBeInTheDocument();
    const publish = screen.getByTestId(
      "admin-announcement-publish",
    ) as HTMLButtonElement;
    expect(publish.disabled).toBe(false);

    fireEvent.click(publish);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const post = server.requests.find(
      (request) =>
        request.method === "POST" && request.path === "/admin/announcements",
    );
    expect(post?.body).toMatchObject({
      active: true,
      fallbackPolicy: "allow_fallback",
      sourceLocale: "ru",
    });
    expect(server.announcements[0]?.completeness).toEqual({
      en: false,
      ru: true,
    });
  });

  it("publishes both languages without a fallback notice", async () => {
    const server = new FakeAdminServer();
    vi.stubGlobal("fetch", server.fetchImpl);
    const onDone = vi.fn();
    renderEditor({ onDone });

    fireEvent.change(screen.getByTestId("admin-announcement-title"), {
      target: { value: "Maintenance" },
    });
    fireEvent.change(screen.getByTestId("admin-announcement-body"), {
      target: { value: "Tonight" },
    });
    fillRu("Плановые работы", "Сегодня");

    expect(
      screen.queryByText("This announcement is available in Russian only."),
    ).toBeNull();
    fireEvent.click(screen.getByTestId("admin-announcement-publish"));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(server.announcements[0]?.completeness).toEqual({
      en: true,
      ru: true,
    });
  });

  it("edits one language without touching the other", async () => {
    const server = new FakeAdminServer();
    server.announcements = [announcement()];
    vi.stubGlobal("fetch", server.fetchImpl);
    const onDone = vi.fn();
    renderEditor({ announcement: announcement(), onDone });

    fireEvent.click(screen.getByTestId("announcement-tab-ru"));
    fireEvent.change(screen.getByTestId("admin-announcement-title-ru"), {
      target: { value: "Новые работы" },
    });
    fireEvent.click(screen.getByTestId("admin-announcement-edit-save"));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const patch = server.requests.find((request) => request.method === "PATCH");
    expect(patch?.body).toMatchObject({
      translations: {
        ru: { title: "Новые работы", body: "Сегодня" },
      },
      version: 1,
    });
  });

  it("sends only dirty locales and reports a stale version", async () => {
    const server = new FakeAdminServer();
    const stale = announcement();
    server.announcements = [{ ...stale, version: 2 }];
    vi.stubGlobal("fetch", server.fetchImpl);
    const onDone = vi.fn();
    renderEditor({ announcement: stale, onDone });

    fireEvent.click(screen.getByTestId("announcement-tab-ru"));
    fireEvent.change(screen.getByTestId("admin-announcement-title-ru"), {
      target: { value: "Новые работы" },
    });
    fireEvent.click(screen.getByTestId("admin-announcement-edit-save"));

    expect(
      await screen.findByText(/Someone else changed this announcement/),
    ).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    expect(server.requests.some((request) => request.method === "PATCH")).toBe(
      true,
    );
  });

  it("blocks the email checkbox on an active announcement", () => {
    vi.stubGlobal("fetch", new FakeAdminServer().fetchImpl);
    renderEditor({ announcement: announcement() });
    const checkbox = screen.getByTestId(
      "admin-announcement-sendemail",
    ) as HTMLButtonElement;
    expect(checkbox.disabled).toBe(true);
    expect(screen.getByTestId("announcement-email-locked")).toHaveTextContent(
      "Save it as a draft",
    );
  });

  it("warns that a future schedule still sends the letter immediately", () => {
    vi.stubGlobal("fetch", new FakeAdminServer().fetchImpl);
    renderEditor({});
    fireEvent.click(screen.getByTestId("admin-announcement-sendemail"));
    fireEvent.change(screen.getByTestId("admin-announcement-starts"), {
      target: { value: "2030-01-01T10:00" },
    });
    expect(
      screen.getByTestId("announcement-email-future-warning"),
    ).toHaveTextContent("queued immediately");
  });

  it("blocks the strict preview when either language is missing", () => {
    vi.stubGlobal("fetch", new FakeAdminServer().fetchImpl);
    renderEditor({});
    fireEvent.change(screen.getByTestId("admin-announcement-title"), {
      target: { value: "Only English" },
    });
    fireEvent.change(screen.getByTestId("admin-announcement-body"), {
      target: { value: "Body" },
    });
    expect(
      screen.getByTestId("announcement-preview-blocked"),
    ).toHaveTextContent("Russian");
  });

  it("renders a read-only operator view without save actions", () => {
    vi.stubGlobal("fetch", new FakeAdminServer().fetchImpl);
    renderEditor({ announcement: announcement(), readOnly: true });
    expect(screen.getByTestId("admin-announcement-title")).toBeDisabled();
    expect(
      screen.queryByTestId("admin-announcement-edit-save"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("admin-announcement-close")).toBeInTheDocument();
  });
});
