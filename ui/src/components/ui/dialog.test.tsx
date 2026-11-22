import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { I18nProvider } from "@/i18n";

function Harness() {
  return (
    <I18nProvider>
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogTitle>Agent control</DialogTitle>
          <DialogDescription>Focus trap probe</DialogDescription>
          <button type="button">Inside action</button>
        </DialogContent>
      </Dialog>
    </I18nProvider>
  );
}

describe("modal focus trap and return (TASK-179.9)", () => {
  it("keeps Tab inside the dialog and returns focus to the trigger on Escape", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open" });
    await user.click(trigger);

    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );

    for (let index = 0; index < 8; index += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it("pads the content and the close button for iOS safe areas (TASK-177.18)", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    const dialog = await screen.findByRole("dialog");
    // `max(1.5rem, env(...))` keeps the p-6 fallback on desktop and in
    // browsers where env() is 0 — no double padding.
    expect(dialog.className).toContain(
      "pt-[max(1.5rem,env(safe-area-inset-top))]",
    );
    expect(dialog.className).toContain(
      "pb-[max(1.5rem,env(safe-area-inset-bottom))]",
    );
    expect(dialog.className).toContain(
      "pl-[max(1.5rem,env(safe-area-inset-left))]",
    );
    expect(dialog.className).toContain(
      "pr-[max(1.5rem,env(safe-area-inset-right))]",
    );
    const close = dialog.querySelector("[data-testid='dialog-close']");
    expect(close?.className).toContain("env(safe-area-inset-top)");
    expect(close?.className).toContain("env(safe-area-inset-right)");
    // The md variants must not fall back to the unsafe 1rem offsets.
    expect(close?.className).toContain(
      "md:right-[max(1rem,env(safe-area-inset-right))]",
    );
    expect(close?.className).toContain(
      "md:top-[max(1rem,env(safe-area-inset-top))]",
    );
  });

  it("offers a 44 px close hit area on touch layouts and a compact one on desktop", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    const dialog = await screen.findByRole("dialog");
    const close = dialog.querySelector(
      "[data-testid='dialog-close']",
    ) as HTMLButtonElement | null;
    expect(close).not.toBeNull();
    expect(close?.className).toContain("h-11");
    expect(close?.className).toContain("w-11");
    // TASK-177.7: tablet widths keep the 44 px target; only desktop compacts.
    expect(close?.className).toContain("lg:h-8");
    expect(close?.className).toContain("lg:w-8");
  });

  it("closes on Escape even when the dialog contains an expanded inline combobox", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <Dialog defaultOpen>
          <DialogContent>
            <DialogTitle>Admin command palette</DialogTitle>
            <DialogDescription>Inline combobox Escape probe</DialogDescription>
            <button
              type="button"
              role="combobox"
              aria-expanded="true"
              aria-haspopup="listbox"
            >
              Search
            </button>
          </DialogContent>
        </Dialog>
      </I18nProvider>,
    );

    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("leaves Escape to an open portalled listbox instead of closing the dialog", async () => {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-radix-popper-content-wrapper", "");
    const listbox = document.createElement("div");
    listbox.setAttribute("role", "listbox");
    listbox.setAttribute("data-state", "open");
    wrapper.appendChild(listbox);
    document.body.appendChild(wrapper);

    const user = userEvent.setup();
    try {
      render(
        <I18nProvider>
          <Dialog defaultOpen>
            <DialogContent>
              <DialogTitle>Agent control</DialogTitle>
              <DialogDescription>
                Portalled listbox Escape probe
              </DialogDescription>
              <button
                type="button"
                role="combobox"
                aria-expanded="true"
                aria-haspopup="listbox"
              >
                Status
              </button>
            </DialogContent>
          </Dialog>
        </I18nProvider>,
      );

      await screen.findByRole("dialog");
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeNull());
    } finally {
      wrapper.remove();
    }
  });
});
