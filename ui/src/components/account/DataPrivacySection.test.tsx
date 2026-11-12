import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/api/client";
import { DataPrivacySection } from "@/components/account/DataPrivacySection";
import { ToastProvider } from "@/components/Toast";
import { I18nProvider } from "@/i18n";

const mocks = vi.hoisted(() => ({
  logout: vi.fn().mockResolvedValue(undefined),
  downloadBlob: vi.fn(),
  authMethod: { value: "password" as "password" | "oauth" },
  hasPassword: { value: true },
}));

vi.mock("@/auth/AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: "user-1",
      email: "owner@example.com",
      displayName: "Owner",
      avatarColor: null,
      avatarPath: null,
      createdAt: 1,
      authMethod: mocks.authMethod.value,
      hasPassword: mocks.hasPassword.value,
      deletionMethod: mocks.hasPassword.value ? "password" : "email_code",
    },
    logout: mocks.logout,
  }),
}));

vi.mock("@/utils/download", () => ({ downloadBlob: mocks.downloadBlob }));

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function fakeApi(handler: (call: Call) => Response | Promise<Response>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body =
      typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    return handler({ method, url, body });
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderSection() {
  return render(
    <I18nProvider>
      <ToastProvider>
        <DataPrivacySection />
      </ToastProvider>
    </I18nProvider>,
  );
}

describe("DataPrivacySection (TASK-166)", () => {
  beforeEach(() => {
    mocks.authMethod.value = "password";
    mocks.hasPassword.value = true;
    api.clearAccessToken();
    vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
    mocks.logout.mockClear();
    mocks.downloadBlob.mockClear();
    localStorage.removeItem("janosik:account-export:user-1");
    vi.spyOn(api, "latestAccountExport").mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("recovers a ready account export after reopening", async () => {
    vi.mocked(api.latestAccountExport).mockResolvedValue({
      id: "previous",
      status: "ready",
      createdAt: 1,
      expiresAt: 2,
      sizeBytes: 10,
      error: null,
    });
    renderSection();
    expect(await screen.findByTestId("account-export-download")).toBeVisible();
    expect(localStorage.getItem("janosik:account-export:user-1")).toBe(
      "previous",
    );
  });

  it("requests an export, shows it ready and downloads the blob", async () => {
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      fakeApi((call) => {
        calls.push(call);
        if (call.url.endsWith("/users/me/export")) {
          return json(
            {
              id: "exp-1",
              status: "ready",
              createdAt: 1,
              expiresAt: 2,
              sizeBytes: 10,
              error: null,
            },
            202,
          );
        }
        return new Response(new Blob(["{}"]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    renderSection();
    await userEvent.click(screen.getByTestId("account-export-request"));

    expect(await screen.findByTestId("account-export-download")).toBeVisible();
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "POST",
          url: expect.stringMatching(/\/users\/me\/export$/),
        }),
      ]),
    );
    await userEvent.click(screen.getByTestId("account-export-download"));
    await waitFor(() => expect(mocks.downloadBlob).toHaveBeenCalledTimes(1));
  });

  it("explains a concurrent export instead of silently failing", async () => {
    vi.stubGlobal(
      "fetch",
      fakeApi(() =>
        json(
          {
            statusCode: 409,
            code: "export_in_progress",
            message: "busy",
          },
          409,
        ),
      ),
    );

    renderSection();
    await userEvent.click(screen.getByTestId("account-export-request"));
    expect(await screen.findByTestId("account-data-error")).toHaveTextContent(
      "already being prepared",
    );
  });

  it("keeps the form and reports a wrong password", async () => {
    vi.stubGlobal(
      "fetch",
      fakeApi(() => json({ message: "Current password is incorrect" }, 401)),
    );

    renderSection();
    await userEvent.type(
      screen.getByTestId("account-delete-email"),
      "owner@example.com",
    );
    await userEvent.type(
      screen.getByTestId("account-delete-password"),
      "wrong pass",
    );
    await userEvent.click(screen.getByTestId("account-delete-submit"));

    expect(await screen.findByTestId("account-data-error")).toHaveTextContent(
      "Current password is incorrect",
    );
    expect(screen.getByTestId("account-delete-password")).toHaveValue(
      "wrong pass",
    );
    expect(mocks.logout).not.toHaveBeenCalled();
  });

  it("maps an oversized export to actionable copy", async () => {
    vi.stubGlobal(
      "fetch",
      fakeApi(() =>
        json(
          {
            statusCode: 413,
            code: "payload_too_large",
            message: "account export exceeds 50 MB",
          },
          413,
        ),
      ),
    );

    renderSection();
    await userEvent.click(screen.getByTestId("account-export-request"));
    expect(await screen.findByTestId("account-data-error")).toHaveTextContent(
      "too large",
    );
  });

  it("maps a rate limit to a retry message", async () => {
    vi.stubGlobal(
      "fetch",
      fakeApi(() =>
        json(
          {
            statusCode: 429,
            code: "rate_limited",
            message: "Too Many Requests",
          },
          429,
        ),
      ),
    );

    renderSection();
    await userEvent.click(screen.getByTestId("account-export-request"));
    expect(await screen.findByTestId("account-data-error")).toHaveTextContent(
      "Too many export requests",
    );
  });

  it("maps request-code 429 to a retry message, not OAuth failure", async () => {
    mocks.hasPassword.value = false;
    vi.stubGlobal(
      "fetch",
      fakeApi((call) => {
        if (call.url.endsWith("/auth/refresh")) {
          return json({ accessToken: "oauth-access", user: { id: "user-1" } });
        }
        return json(
          { statusCode: 429, code: "rate_limited", message: "slow down" },
          429,
        );
      }),
    );

    renderSection();
    await userEvent.type(
      screen.getByTestId("account-delete-email"),
      "owner@example.com",
    );
    await userEvent.click(screen.getByTestId("account-delete-request-code"));
    expect(await screen.findByTestId("account-data-error")).toHaveTextContent(
      "Too many export requests",
    );
  });

  it("requires the typed email and a password before scheduling deletion", async () => {
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      fakeApi((call) => {
        calls.push(call);
        return json({ status: "scheduled", deleteAfter: 123 }, 202);
      }),
    );

    renderSection();
    const submit = screen.getByTestId("account-delete-submit");
    expect(submit).toBeDisabled();

    await userEvent.type(
      screen.getByTestId("account-delete-email"),
      "owner@example.com",
    );
    await userEvent.type(
      screen.getByTestId("account-delete-password"),
      "secret pass",
    );
    expect(submit).toBeEnabled();
    await userEvent.click(submit);

    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "DELETE",
        url: "http://api.test/api/v1/users/me",
        body: {
          confirmEmail: "owner@example.com",
          password: "secret pass",
        },
      }),
    );
    expect(mocks.logout).toHaveBeenCalled();
  });

  it("uses the password flow when an OAuth login lands in a password account", () => {
    mocks.authMethod.value = "oauth";
    mocks.hasPassword.value = true;
    renderSection();
    expect(screen.getByTestId("account-delete-password")).toBeVisible();
    expect(screen.queryByTestId("account-delete-code")).toBeNull();
  });

  it("shows the email-code flow for an OAuth-only account", async () => {
    mocks.authMethod.value = "password";
    mocks.hasPassword.value = false;
    api.setAccessToken("oauth-access");
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      fakeApi((call) => {
        calls.push(call);
        if (call.url.endsWith("/auth/refresh")) {
          return json({
            accessToken: "oauth-access",
            user: { id: "user-1", email: "owner@example.com" },
          });
        }
        if (call.url.endsWith("/users/me/delete/request-code")) {
          return json({ expiresAt: 1, queued: true });
        }
        return json({ status: "scheduled", deleteAfter: 123 }, 202);
      }),
    );

    renderSection();
    expect(screen.getByTestId("account-delete-code")).toBeVisible();
    expect(screen.queryByTestId("account-delete-password")).toBeNull();

    await userEvent.type(
      screen.getByTestId("account-delete-email"),
      "owner@example.com",
    );
    await userEvent.click(screen.getByTestId("account-delete-request-code"));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "POST",
        url: "http://api.test/api/v1/users/me/delete/request-code",
        body: { oauthProof: "oauth-access" },
      }),
    );

    await userEvent.type(screen.getByTestId("account-delete-code"), "123456");
    await userEvent.click(screen.getByTestId("account-delete-submit"));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "DELETE",
        url: "http://api.test/api/v1/users/me",
        body: {
          confirmEmail: "owner@example.com",
          oauthProof: "oauth-access",
          emailCode: "123456",
        },
      }),
    );
  });
});
