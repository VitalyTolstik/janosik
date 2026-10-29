import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n";
import { TimePickerPanel } from "./TimePicker";

/**
 * TASK-156: arrow keys move the selection in both columns but only a
 * click/Enter confirms — the minute column used to close the picker on
 * `ArrowDown`.
 */
describe("TimePickerPanel", () => {
  it("does not confirm when arrowing through the minute column", () => {
    const onChange = vi.fn();
    const onConfirm = vi.fn();
    render(
      <I18nProvider>
        <TimePickerPanel
          value="10:30"
          onChange={onChange}
          onConfirm={onConfirm}
        />
      </I18nProvider>,
    );

    const minutes = screen.getByRole("listbox", { name: "Minutes" });
    fireEvent.keyDown(minutes, { key: "ArrowDown" });

    expect(onChange).toHaveBeenCalledWith("10:31");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirms on a minute click", () => {
    const onChange = vi.fn();
    const onConfirm = vi.fn();
    render(
      <I18nProvider>
        <TimePickerPanel
          value="10:30"
          onChange={onChange}
          onConfirm={onConfirm}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("option", { name: "31" }));

    expect(onChange).toHaveBeenCalledWith("10:31");
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
