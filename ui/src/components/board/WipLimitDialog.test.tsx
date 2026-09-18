import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n";
import { WipLimitDialog } from "@/components/board/WipLimitDialog";

/**
 * The WIP-limit dialog (TASK-13): save commits a value, an empty input or
 * the explicit button removes the limit, out-of-range input is clamped.
 */
describe("WipLimitDialog", () => {
  const setup = (initialLimit?: number) => {
    const onSave = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <I18nProvider>
        <WipLimitDialog
          open
          columnTitle="Backlog"
          initialLimit={initialLimit}
          onOpenChange={onOpenChange}
          onSave={onSave}
        />
      </I18nProvider>,
    );
    return { onSave, onOpenChange };
  };

  it("saves a typed limit and closes", () => {
    const { onSave, onOpenChange } = setup();
    fireEvent.change(screen.getByRole("textbox", { name: "WIP limit" }), {
      target: { value: "4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(4);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("saves an empty input as limit removal", () => {
    const { onSave } = setup(3);
    // The draft is pre-filled with the current limit — clear it first.
    fireEvent.change(screen.getByRole("textbox", { name: "WIP limit" }), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(undefined);
  });

  it("clamps out-of-range values into the allowed range", async () => {
    const { LIMITS } = await import("@janosik/shared");
    const { onSave } = setup();
    const input = screen.getByRole("textbox", { name: "WIP limit" });
    fireEvent.change(input, {
      target: { value: String(LIMITS.wipLimitMax + 100) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(LIMITS.wipLimitMax);
  });

  it("steps the limit with the themed spinner buttons", () => {
    const { onSave } = setup();
    const input = screen.getByRole("textbox", { name: "WIP limit" });

    fireEvent.click(screen.getByRole("button", { name: "Increase limit" }));
    expect(input).toHaveValue("1");
    fireEvent.click(screen.getByRole("button", { name: "Increase limit" }));
    expect(input).toHaveValue("2");

    // Decrease never drops below the minimum of 1.
    fireEvent.click(screen.getByRole("button", { name: "Decrease limit" }));
    fireEvent.click(screen.getByRole("button", { name: "Decrease limit" }));
    expect(input).toHaveValue("1");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(1);
  });

  it("steps with the arrow keys and drops non-digits", () => {
    setup(5);
    const input = screen.getByRole("textbox", { name: "WIP limit" });

    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveValue("6");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveValue("5");
    fireEvent.change(input, { target: { value: "a7b" } });
    expect(input).toHaveValue("7");
  });

  it("shows the remove button only when a limit is set", () => {
    setup(3);
    expect(
      screen.getByRole("button", { name: "Remove limit" }),
    ).toBeInTheDocument();
  });

  it("the remove button saves undefined in one click", () => {
    const { onSave, onOpenChange } = setup(3);
    fireEvent.click(screen.getByRole("button", { name: "Remove limit" }));
    expect(onSave).toHaveBeenCalledWith(undefined);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("discards the draft when the dialog is reopened (reset by remount)", () => {
    // Draft state lives inside DialogContent, which Radix unmounts on close —
    // reopening must show the current limit, never the abandoned edit.
    const { rerender } = render(
      <I18nProvider>
        <WipLimitDialog
          open
          columnTitle="Backlog"
          initialLimit={3}
          onOpenChange={() => {}}
          onSave={() => {}}
        />
      </I18nProvider>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "WIP limit" }), {
      target: { value: "7" },
    });
    expect(screen.getByRole("textbox", { name: "WIP limit" })).toHaveValue("7");

    rerender(
      <I18nProvider>
        <WipLimitDialog
          open={false}
          columnTitle="Backlog"
          initialLimit={3}
          onOpenChange={() => {}}
          onSave={() => {}}
        />
      </I18nProvider>,
    );
    expect(screen.queryByRole("textbox", { name: "WIP limit" })).toBeNull();

    rerender(
      <I18nProvider>
        <WipLimitDialog
          open
          columnTitle="Backlog"
          initialLimit={3}
          onOpenChange={() => {}}
          onSave={() => {}}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole("textbox", { name: "WIP limit" })).toHaveValue("3");
  });
});
