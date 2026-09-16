import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LabelPicker } from "@/components/board/LabelPicker";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n";
import type { Label } from "@janosik/shared";

/**
 * Smoke tests for the card label picker (T-8): toggling an existing label,
 * creating a new one, and deleting one through the inline confirmation.
 */

const LABEL: Label = { id: "l-1", name: "Bug", color: "red" };

function renderPicker(overrides: Partial<Parameters<typeof LabelPicker>[0]>) {
  const props = {
    labels: [LABEL],
    selected: [] as string[],
    onToggle: vi.fn(),
    onCreate: vi.fn(),
    onRename: vi.fn(),
    onRecolor: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  render(
    <I18nProvider>
      <ToastProvider>
        <TooltipProvider>
          <LabelPicker {...props} />
        </TooltipProvider>
      </ToastProvider>
    </I18nProvider>,
  );
  return props;
}

describe("LabelPicker", () => {
  it("renders the board labels and toggles one on click", async () => {
    const { onToggle } = renderPicker({});
    expect(screen.getByRole("button", { name: "Bug" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Bug" }));

    expect(onToggle).toHaveBeenCalledWith("l-1");
  });

  it("creates a new label with the picked name and color", async () => {
    const { onCreate } = renderPicker({});

    await userEvent.click(screen.getByRole("button", { name: "New label" }));
    await userEvent.type(screen.getByPlaceholderText("Label name"), "Feature");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(onCreate).toHaveBeenCalledWith("Feature", "brand");
  });

  it("deletes a label after the inline confirmation", async () => {
    const { onDelete } = renderPicker({});

    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Delete label" }),
    );
    expect(await screen.findByText("Delete this label?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete label" }));

    expect(onDelete).toHaveBeenCalledWith("l-1");
  });
});
