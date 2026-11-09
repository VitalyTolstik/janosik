import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ColumnAccentPicker } from "@/components/board/ColumnAccentPicker";
import { I18nProvider } from "@/i18n";
import type { CardCover } from "@janosik/shared";

function renderPicker(accent?: CardCover) {
  const onChange = vi.fn();
  const view = render(
    <I18nProvider>
      <ColumnAccentPicker
        columnId="col-1"
        title="In progress"
        accent={accent}
        columnStyle="signature"
        onChange={onChange}
      />
    </I18nProvider>,
  );
  return { onChange, view };
}

describe("ColumnAccentPicker (TASK-164)", () => {
  it("opens the palette with all 12 colors and 6 gradients", () => {
    renderPicker();
    fireEvent.click(screen.getByTestId("column-style-trigger"));

    expect(screen.getByTestId("column-style-palette")).toBeInTheDocument();
    // 12 color radios + 6 gradient radios.
    expect(screen.getAllByRole("radio")).toHaveLength(18);
    for (const id of [
      "column-style-option-brand",
      "column-style-option-ocean",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it("applies a color and a gradient immediately", () => {
    const { onChange } = renderPicker();
    fireEvent.click(screen.getByTestId("column-style-trigger"));
    fireEvent.click(screen.getByTestId("column-style-option-brand"));
    expect(onChange).toHaveBeenCalledWith({
      type: "color",
      value: "brand",
    });

    fireEvent.click(screen.getByTestId("column-style-option-ocean"));
    expect(onChange).toHaveBeenCalledWith({
      type: "gradient",
      value: "ocean",
    });
  });

  it("marks the current accent and clears it", () => {
    const { onChange } = renderPicker({ type: "color", value: "brand" });
    fireEvent.click(screen.getByTestId("column-style-trigger"));

    expect(screen.getByTestId("column-style-option-brand")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByTestId("column-style-option-red")).toHaveAttribute(
      "aria-checked",
      "false",
    );

    fireEvent.click(screen.getByTestId("column-style-reset"));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("previews the live shape and accent", () => {
    renderPicker({ type: "gradient", value: "ocean" });
    fireEvent.click(screen.getByTestId("column-style-trigger"));

    const preview = screen.getByTestId("column-style-preview");
    expect(preview).toHaveAttribute("data-column-accent", "ocean");
    expect(preview).toHaveAttribute("data-column-accent-type", "gradient");
    expect(preview).toHaveAttribute("data-column-accent-style", "signature");
    expect(
      preview.querySelector(".janosik-column-accent-heading"),
    ).toHaveTextContent("In progress");
  });

  it("does not let a keyboard activation bubble to the column drag handle", () => {
    const bubble = vi.fn();
    render(
      <div onKeyDown={bubble}>
        <I18nProvider>
          <ColumnAccentPicker
            columnId="col-1"
            title="In progress"
            columnStyle="signature"
            onChange={vi.fn()}
          />
        </I18nProvider>
      </div>,
    );

    fireEvent.keyDown(screen.getByTestId("column-style-trigger"), {
      key: " ",
    });
    expect(bubble).not.toHaveBeenCalled();
  });
});
