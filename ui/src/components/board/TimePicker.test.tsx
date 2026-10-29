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

  it("confirms an hour on click and Enter, but not on arrows (TASK-156 review)", () => {
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

    // Arrows move the hour selection without confirming.
    const hours = screen.getByRole("listbox", { name: "Hours" });
    fireEvent.keyDown(hours, { key: "ArrowUp" });
    expect(onChange).toHaveBeenCalledWith("09:30");
    expect(onConfirm).not.toHaveBeenCalled();

    // Enter on the (now focused) option confirms that selection — once,
    // not twice through the native button activation.
    const nine = hours.querySelector<HTMLElement>('[data-value="9"]');
    expect(nine).not.toBeNull();
    fireEvent.keyDown(nine!, { key: "Enter" });
    expect(onConfirm).toHaveBeenCalledTimes(1);

    // A click on an hour confirms too.
    const eleven = hours.querySelector<HTMLElement>('[data-value="11"]');
    fireEvent.click(eleven!);
    expect(onChange).toHaveBeenCalledWith("11:30");
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });
});
