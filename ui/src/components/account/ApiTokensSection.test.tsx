import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/api/client";
import { ApiTokensSection } from "@/components/account/ApiTokensSection";
import { ToastProvider } from "@/components/Toast";
import { I18nProvider } from "@/i18n";
import { FakeServer } from "@/test/fake-server";

/**
 * API keys section (TASK-36.1): the plaintext is revealed exactly once with
 * a copy action, the list never contains it, and revocation is confirmed and
 * immediate.
 */

type FetchHandler = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function renderTokens(
  server: FakeServer,
  handler: FetchHandler = server.handle,
) {
  vi.stubGlobal("fetch", handler);
  return render(
    <I18nProvider>
      <ToastProvider>
        <ApiTokensSection />
      </ToastProvider>
    </I18nProvider>,
  );
}

function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

describe("ApiTokensSection (TASK-36.1)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
    api.clearAccessToken();
    api.onAuthLost = null;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("shows a busy list skeleton until the first response", async () => {
    const server = new FakeServer();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler: FetchHandler = async (input, init) => {
      await gate;
      return server.handle(input, init);
    };

    renderTokens(server, handler);

    const section = screen.getByTestId("account-tokens");
    expect(section).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("account-tokens-skeleton")).toHaveAttribute(
      "aria-busy",
      "true",
    );

    act(() => release());

    expect(await screen.findByText("No API keys yet")).toBeInTheDocument();
    expect(screen.queryByTestId("account-tokens-skeleton")).toBeNull();
    expect(section).toHaveAttribute("aria-busy", "false");
  });

  it("shows the empty state", async () => {
    const server = new FakeServer();
    renderTokens(server);

    expect(await screen.findByText("No API keys yet")).toBeInTheDocument();
  });

  it("creates a key, reveals it once and copies it", async () => {
    const writeText = stubClipboard();
    const server = new FakeServer();
    renderTokens(server);

    await screen.findByText("No API keys yet");
    await userEvent.click(screen.getByTestId("token-create"));
    await userEvent.type(screen.getByTestId("token-name"), "CI pipeline");
    await userEvent.click(screen.getByTestId("token-create-submit"));

    const reveal = await screen.findByTestId("token-reveal");
    const token = reveal.textContent ?? "";
    expect(token.startsWith("jnk_")).toBe(true);
    expect(server.apiTokens[0].name).toBe("CI pipeline");
    expect(server.requests).toContainEqual({
      method: "POST",
      path: "/api/v1/users/me/tokens",
      body: {
        name: "CI pipeline",
        expiresAt: null,
        boardId: null,
        scopePreset: "worker",
        trustedCi: false,
        readOnly: false,
        rateLimitPerMinute: null,
      },
    });

    await userEvent.click(screen.getByTestId("token-copy"));
    expect(writeText).toHaveBeenCalledWith(token);
    expect(await screen.findByText("Key copied")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("token-done"));
    const row = await screen.findByTestId("token-row");
    expect(row).toHaveTextContent("CI pipeline");
    expect(row).toHaveTextContent("Active");
    // The list (and the fresh GET) never carry the plaintext again.
    expect(row.textContent).not.toContain("jnk_");
  });

  it("sends the chosen expiry as an ISO string", async () => {
    const server = new FakeServer();
    renderTokens(server);
    await screen.findByText("No API keys yet");

    await userEvent.click(screen.getByTestId("token-create"));
    await userEvent.type(screen.getByTestId("token-name"), "Short lived");
    await userEvent.click(screen.getByTestId("token-expiry"));
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: "In 30 days" }),
    );
    await userEvent.click(screen.getByTestId("token-create-submit"));

    await screen.findByTestId("token-reveal");
    const request = server.requests.find(
      (entry) =>
        entry.method === "POST" && entry.path === "/api/v1/users/me/tokens",
    );
    const body = request?.body as { expiresAt: string };
    expect(typeof body.expiresAt).toBe("string");
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("shows an inline error for an invalid API key rate limit", async () => {
    const server = new FakeServer();
    renderTokens(server);
    await screen.findByText("No API keys yet");
    await userEvent.click(screen.getByTestId("token-create"));
    await userEvent.type(screen.getByTestId("token-name"), "Agent");
    await userEvent.type(screen.getByTestId("token-rate"), "0");
    await userEvent.click(screen.getByTestId("token-create-submit"));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a whole number between",
    );
    expect(screen.getByTestId("token-rate")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByTestId("token-rate")).toHaveAttribute(
      "aria-describedby",
      "token-rate-error",
    );

    const rate = screen.getByTestId("token-rate");
    await userEvent.clear(rate);
    await userEvent.type(rate, "120");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(rate).not.toHaveAttribute("aria-invalid");
    expect(rate).not.toHaveAttribute("aria-describedby");
    expect(
      server.requests.some(
        (request) =>
          request.method === "POST" &&
          request.path === "/api/v1/users/me/tokens",
      ),
    ).toBe(false);
  });

  it("renders themed app controls instead of native checkbox/number inputs", async () => {
    const server = new FakeServer();
    renderTokens(server);
    await screen.findByText("No API keys yet");
    await userEvent.click(screen.getByTestId("token-create"));

    const dialog = await screen.findByTestId("token-dialog");
    expect(dialog.querySelector('input[type="number"]')).toBeNull();
    expect(dialog.querySelector('input[type="checkbox"]')).toBeNull();
    const readOnly = within(dialog).getByRole("checkbox", {
      name: "Read-only (writes refused)",
    });
    expect(readOnly).toHaveAttribute("aria-checked", "false");
    await userEvent.click(
      within(dialog).getByText("Read-only (writes refused)"),
    );
    expect(readOnly).toHaveAttribute("aria-checked", "true");

    const rate = within(dialog).getByTestId("token-rate");
    expect(rate.tagName).toBe("INPUT");
    expect((rate as HTMLInputElement).type).toBe("text");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Increase rate limit" }),
    );
    expect(rate).toHaveValue("1");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Decrease rate limit" }),
    );
    expect(rate).toHaveValue("1");
  });

  it("sends read-only and a rate limit (TASK-157)", async () => {
    const server = new FakeServer();
    renderTokens(server);

    await screen.findByText("No API keys yet");
    await userEvent.click(screen.getByTestId("token-create"));
    await userEvent.type(screen.getByTestId("token-name"), "Agent");
    await userEvent.click(screen.getByTestId("token-read-only"));
    await userEvent.type(screen.getByTestId("token-rate"), "120");
    await userEvent.click(screen.getByTestId("token-create-submit"));

    await screen.findByTestId("token-reveal");
    expect(server.requests).toContainEqual({
      method: "POST",
      path: "/api/v1/users/me/tokens",
      body: {
        name: "Agent",
        expiresAt: null,
        boardId: null,
        scopePreset: "worker",
        trustedCi: false,
        readOnly: true,
        rateLimitPerMinute: 120,
      },
    });
  });

  it("sends the chosen scope preset and trusted CI flag (TASK-166)", async () => {
    const server = new FakeServer();
    renderTokens(server);

    await screen.findByText("No API keys yet");
    await userEvent.click(screen.getByTestId("token-create"));
    await userEvent.type(screen.getByTestId("token-name"), "Release bot");
    await userEvent.click(screen.getByTestId("token-scope-preset"));
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: "Reviewer" }),
    );
    await userEvent.click(screen.getByTestId("token-trusted-ci"));
    await userEvent.click(screen.getByTestId("token-create-submit"));

    await screen.findByTestId("token-reveal");
    expect(server.requests).toContainEqual({
      method: "POST",
      path: "/api/v1/users/me/tokens",
      body: {
        name: "Release bot",
        expiresAt: null,
        boardId: null,
        scopePreset: "reviewer",
        trustedCi: true,
        readOnly: false,
        rateLimitPerMinute: null,
      },
    });
    expect(server.apiTokens[0]).toMatchObject({
      scopePreset: "reviewer",
      trustedCi: true,
      effectiveTokenScope: "reviewer",
    });

    await userEvent.click(screen.getByTestId("token-done"));
    const row = await screen.findByTestId("token-row");
    expect(within(row).getByTestId("token-effective-scope")).toHaveTextContent(
      "Reviewer scope",
    );
    expect(row).toHaveTextContent("Trusted CI");
  });

  it("disables trusted CI for an Observer or read-only key", async () => {
    const server = new FakeServer();
    renderTokens(server);
    await screen.findByText("No API keys yet");
    await userEvent.click(screen.getByTestId("token-create"));

    const trusted = screen.getByTestId("token-trusted-ci");
    expect(trusted).toBeEnabled();
    await userEvent.click(screen.getByTestId("token-scope-preset"));
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: "Observer" }),
    );
    expect(trusted).toBeDisabled();
    expect(
      screen.getByText(/Not available for an Observer or read-only key/i),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("token-scope-preset"));
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: "Worker" }),
    );
    expect(trusted).toBeEnabled();
    await userEvent.click(screen.getByTestId("token-read-only"));
    expect(trusted).toBeDisabled();
    expect(trusted).toHaveAttribute("aria-checked", "false");
  });

  it("shows readOnly as an effective observer scope", async () => {
    const server = new FakeServer();
    server.apiTokens.push({
      id: "token-ro",
      name: "Auditor",
      createdAt: Date.UTC(2026, 0, 1),
      lastUsedAt: null,
      expiresAt: null,
      revokedAt: null,
      boardId: null,
      readOnly: true,
      rateLimitPerMinute: null,
      scopePreset: "admin",
      trustedCi: false,
      individualPausedAt: null,
      individualPausedBy: null,
      individualPausedReason: null,
      stopAllPausedAt: null,
      stopAllPausedBy: null,
      paused: false,
      effectiveTokenScope: "observer",
    });
    renderTokens(server);

    const row = await screen.findByTestId("token-row");
    expect(within(row).getByTestId("token-effective-scope")).toHaveTextContent(
      "Observer scope",
    );
    expect(row).toHaveTextContent("Read-only");
  });

  it("revokes only after the confirmation", async () => {
    const server = new FakeServer();
    server.apiTokens.push({
      id: "token-1",
      name: "Laptop",
      createdAt: Date.UTC(2026, 0, 1),
      lastUsedAt: null,
      expiresAt: null,
      revokedAt: null,
      boardId: null,
      readOnly: false,
      rateLimitPerMinute: null,
      scopePreset: "worker",
      trustedCi: false,
      individualPausedAt: null,
      individualPausedBy: null,
      individualPausedReason: null,
      stopAllPausedAt: null,
      stopAllPausedBy: null,
      paused: false,
      effectiveTokenScope: "worker",
    });
    renderTokens(server);

    await userEvent.click(await screen.findByTestId("token-revoke"));

    const confirm = await screen.findByRole("dialog", {
      name: "Revoke this key?",
    });
    expect(confirm).toHaveTextContent("Laptop");
    expect(
      server.requests.some(
        (entry) => entry.method === "DELETE" && entry.path.includes("token-1"),
      ),
    ).toBe(false);

    await userEvent.click(
      within(confirm).getByRole("button", { name: "Revoke" }),
    );

    await waitFor(() =>
      expect(server.requests).toContainEqual({
        method: "DELETE",
        path: "/api/v1/users/me/tokens/token-1",
        body: {},
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("token-row")).toHaveTextContent("Revoked"),
    );
    expect(screen.queryByTestId("token-revoke")).toBeNull();
  });
});
