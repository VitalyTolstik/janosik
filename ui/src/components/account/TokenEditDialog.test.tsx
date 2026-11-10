import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardSummary, UserTokenDto } from "@janosik/shared";

import { api, ApiError } from "@/api/client";
import { TokenEditDialog } from "@/components/account/TokenEditDialog";
import { ToastProvider } from "@/components/Toast";
import { Dialog } from "@/components/ui/dialog";
import { I18nProvider } from "@/i18n";

function token(overrides: Partial<UserTokenDto> = {}): UserTokenDto {
  return {
    id: "token-1",
    name: "Release bot",
    createdAt: Date.UTC(2026, 0, 1),
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    boardId: null,
    readOnly: false,
    rateLimitPerMinute: 120,
    scopePreset: "worker",
    trustedCi: false,
    individualPausedAt: null,
    individualPausedBy: null,
    individualPausedReason: null,
    stopAllPausedAt: null,
    stopAllPausedBy: null,
    paused: false,
    effectiveTokenScope: "worker",
    ...overrides,
  };
}

const BOARDS: BoardSummary[] = [
  {
    id: "board-1",
    title: "Launch board",
    counters: { cards: 1, columns: 1 },
    role: "ADMIN",
  },
];

function renderDialog(value = token(), onSaved = vi.fn(), onClose = vi.fn()) {
  return render(
    <I18nProvider>
      <ToastProvider>
        <Dialog open>
          <TokenEditDialog
            token={value}
            boards={BOARDS}
            onSaved={onSaved}
            onClose={onClose}
          />
        </Dialog>
      </ToastProvider>
    </I18nProvider>,
  );
}

describe("TokenEditDialog (TASK-166.15)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("prefills the stored limits and saves the edited scope", async () => {
    const updated = token({
      name: "CI release",
      boardId: "board-1",
      scopePreset: "reviewer",
      trustedCi: true,
      rateLimitPerMinute: 500,
      effectiveTokenScope: "reviewer",
    });
    const save = vi.spyOn(api, "updateToken").mockResolvedValue(updated);
    const onSaved = vi.fn();

    renderDialog(token(), onSaved);
    expect(screen.getByTestId("token-edit-name")).toHaveValue("Release bot");
    expect(screen.getByTestId("token-edit-rate")).toHaveValue("120");

    await userEvent.clear(screen.getByTestId("token-edit-name"));
    await userEvent.type(screen.getByTestId("token-edit-name"), "CI release");
    await userEvent.click(screen.getByTestId("token-edit-board"));
    await userEvent.click(
      screen.getByTestId("token-edit-board-option-board-1"),
    );
    await userEvent.click(screen.getByTestId("token-edit-scope-preset"));
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: "Reviewer" }),
    );
    await userEvent.click(screen.getByTestId("token-edit-trusted-ci"));
    const rate = screen.getByTestId("token-edit-rate");
    await userEvent.clear(rate);
    await userEvent.type(rate, "500");
    await userEvent.click(screen.getByTestId("token-edit-save"));

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith("token-1", {
        name: "CI release",
        boardId: "board-1",
        scopePreset: "reviewer",
        trustedCi: true,
        readOnly: false,
        rateLimitPerMinute: 500,
      }),
    );
    expect(onSaved).toHaveBeenCalledWith(updated);
    expect(await screen.findByText("API key updated")).toBeInTheDocument();
  });

  it("disables trusted CI for an Observer key", () => {
    renderDialog(
      token({ scopePreset: "observer", effectiveTokenScope: "observer" }),
    );

    expect(screen.getByTestId("token-edit-trusted-ci")).toBeDisabled();
    expect(
      screen.getByText(
        "Not available for an Observer or read-only key: scope is checked before the destructive gate.",
      ),
    ).toBeInTheDocument();
  });

  it("validates the rate limit before sending", async () => {
    const save = vi.spyOn(api, "updateToken");
    renderDialog();

    const rate = screen.getByTestId("token-edit-rate");
    await userEvent.clear(rate);
    await userEvent.type(rate, "0");
    await userEvent.click(screen.getByTestId("token-edit-save"));

    expect(
      await screen.findByText("Enter a whole number between 1 and 100000."),
    ).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps the dialog open and explains a session-only refusal", async () => {
    vi.spyOn(api, "updateToken").mockRejectedValue(
      new ApiError(403, { code: "pat_forbidden", message: "PAT" }),
    );
    renderDialog();

    await userEvent.click(screen.getByTestId("token-edit-save"));

    expect(await screen.findByTestId("token-edit-error")).toHaveTextContent(
      "Sign in with a browser session to edit an API key",
    );
  });
});
