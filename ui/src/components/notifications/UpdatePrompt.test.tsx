import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  UpdateAvailabilityProvider,
  UpdatePrompt,
} from "@/components/notifications/UpdatePrompt";
import { I18nProvider } from "@/i18n";

const { applyServiceWorkerUpdate } = vi.hoisted(() => ({
  applyServiceWorkerUpdate: vi.fn(),
}));

vi.mock("@/pwa/register-sw", () => ({
  UPDATE_EVENT: "janosik:update-available",
  applyServiceWorkerUpdate,
}));

const UPDATE_EVENT = "janosik:update-available";

function announceUpdate() {
  act(() => {
    window.dispatchEvent(new Event(UPDATE_EVENT));
  });
}

function renderPrompt(variant: "inline" | "floating" = "inline") {
  return render(
    <I18nProvider>
      <UpdatePrompt variant={variant} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  applyServiceWorkerUpdate.mockReset();
});

describe("UpdatePrompt", () => {
  it("stays hidden until the service worker announces an update", () => {
    renderPrompt();
    expect(screen.queryByTestId("update-prompt")).not.toBeInTheDocument();

    announceUpdate();
    expect(screen.getByTestId("update-prompt")).toHaveAttribute(
      "data-tone",
      "brand",
    );
  });

  it("applies the waiting update from the reload action", async () => {
    renderPrompt();
    announceUpdate();

    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(applyServiceWorkerUpdate).toHaveBeenCalledTimes(1);
  });

  it("can be dismissed for the current session", async () => {
    renderPrompt();
    announceUpdate();

    await userEvent.click(
      screen.getByRole("button", { name: "Dismiss notification" }),
    );
    expect(screen.queryByTestId("update-prompt")).not.toBeInTheDocument();
  });

  it("shows the update eyebrow and body in the inline stack", () => {
    renderPrompt("inline");
    announceUpdate();

    const prompt = screen.getByTestId("update-prompt");
    expect(prompt).toHaveTextContent("Update");
    expect(prompt).toHaveTextContent("Reload the page to get the latest");
  });

  it("keeps the compact fallback for screens without a notice stack", () => {
    renderPrompt("floating");
    announceUpdate();

    const prompt = screen.getByTestId("update-prompt");
    expect(prompt).toHaveTextContent("A new version is ready.");
    expect(prompt).not.toHaveTextContent("Reload the page to get the latest");
  });

  it("keeps the announcement when the prompt moves between placements", () => {
    const Harness = ({ variant }: { variant: "inline" | "floating" }) => (
      <I18nProvider>
        <UpdateAvailabilityProvider>
          <UpdatePrompt variant={variant} />
        </UpdateAvailabilityProvider>
      </I18nProvider>
    );
    const { rerender } = render(<Harness variant="floating" />);
    announceUpdate();
    expect(screen.getByTestId("update-prompt")).toBeInTheDocument();

    rerender(<Harness variant="inline" />);

    expect(screen.getByTestId("update-prompt")).toHaveTextContent(
      "Reload the page to get the latest",
    );
  });
});
