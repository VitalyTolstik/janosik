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

  it("offers a 44 px close hit area on mobile and a compact one on desktop", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    const dialog = await screen.findByRole("dialog");
    const close = dialog.querySelector(
      "[data-radix-dialog-close], button[class*='right-2']",
    ) as HTMLButtonElement | null;
    expect(close).not.toBeNull();
    expect(close?.className).toContain("h-11");
    expect(close?.className).toContain("w-11");
    expect(close?.className).toContain("md:h-8");
  });
});
