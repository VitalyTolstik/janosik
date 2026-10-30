import { render, screen, waitFor, within } from "@testing-library/react";
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

function renderTokens(server: FakeServer) {
  vi.stubGlobal("fetch", server.handle);
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
        readOnly: true,
        rateLimitPerMinute: 120,
      },
    });
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
