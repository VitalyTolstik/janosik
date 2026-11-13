import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SelectField } from "@/components/ui/select-field";

const OPTIONS = [
  { value: "alpha", label: "Alpha" },
  { value: "beta", label: "Beta" },
  { value: "gamma", label: "Gamma" },
] as const;

function optionId(listbox: HTMLElement, index: number): string {
  return `${listbox.id}-option-${index}`;
}

describe("SelectField combobox (TASK-179.9)", () => {
  it("exposes combobox/listbox semantics and tracks the active option", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SelectField
        value="alpha"
        options={OPTIONS}
        onChange={onChange}
        ariaLabel="Pick a value"
        testId="picker"
      />,
    );

    const trigger = screen.getByTestId("picker");
    expect(trigger).toHaveAttribute("role", "combobox");
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).not.toHaveAttribute("aria-activedescendant");
    expect(trigger).not.toHaveAttribute("aria-controls");
    expect(document.querySelector("select")).toBeNull();

    await user.click(trigger);
    const listbox = screen.getByTestId("picker-listbox");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", listbox.id);
    expect(listbox).toHaveAttribute("role", "listbox");
    expect(listbox.style.pointerEvents).toBe("auto");
    expect(trigger).toHaveAttribute(
      "aria-activedescendant",
      optionId(listbox, 0),
    );

    await user.keyboard("{ArrowDown}");
    expect(trigger).toHaveAttribute(
      "aria-activedescendant",
      optionId(listbox, 1),
    );

    await user.keyboard("{End}");
    expect(trigger).toHaveAttribute(
      "aria-activedescendant",
      optionId(listbox, 2),
    );

    await user.keyboard("{Home}");
    expect(trigger).toHaveAttribute(
      "aria-activedescendant",
      optionId(listbox, 0),
    );

    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("alpha");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("moves, selects and typeaheads with the keyboard", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SelectField
        value="alpha"
        options={OPTIONS}
        onChange={onChange}
        ariaLabel="Pick a value"
        testId="picker"
      />,
    );

    const trigger = screen.getByTestId("picker");
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    const listbox = screen.getByTestId("picker-listbox");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("beta");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.keyboard("{ArrowDown}");
    await user.keyboard("g");
    expect(trigger).toHaveAttribute(
      "aria-activedescendant",
      optionId(listbox, 2),
    );
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("gamma");
  });

  it("closes on Escape without bubbling to an outer dialog", async () => {
    const user = userEvent.setup();
    const outer = vi.fn();
    render(
      <div
        onKeyDown={(event) => {
          if (event.key === "Escape") outer();
        }}
      >
        <SelectField
          value="alpha"
          options={OPTIONS}
          onChange={vi.fn()}
          ariaLabel="Pick a value"
          testId="picker"
        />
      </div>,
    );

    const trigger = screen.getByTestId("picker");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
    expect(outer).not.toHaveBeenCalled();
  });

  it("keeps the listbox open when a dialog-like focus trap moves focus, and Escape still closes only it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <div>
        <SelectField
          value="alpha"
          options={OPTIONS}
          onChange={onChange}
          ariaLabel="Pick a value"
          testId="picker"
        />
        <button type="button">Outside focus target</button>
      </div>,
    );

    const trigger = screen.getByTestId("picker");
    await user.click(trigger);
    expect(screen.getByTestId("picker-listbox")).toBeInTheDocument();

    screen.getByRole("button", { name: "Outside focus target" }).focus();
    // A Dialog focus trap may do this immediately after the portalled listbox
    // opens; it must not be treated as a dismissal.
    expect(screen.getByTestId("picker-listbox")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("picker-listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps 36 px desktop rows and 44 px mobile rows", async () => {
    const user = userEvent.setup();
    render(
      <SelectField
        value="alpha"
        options={OPTIONS}
        onChange={vi.fn()}
        ariaLabel="Pick a value"
        testId="picker"
      />,
    );
    await user.click(screen.getByTestId("picker"));
    const option = screen.getByTestId("picker-option-beta");
    expect(option.className).toContain("min-h-9");
    expect(option.className).toContain("max-md:min-h-11");
    expect(option).toHaveAttribute("role", "option");
  });

  it("selects with Space and closes on Tab", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SelectField
        value="alpha"
        options={OPTIONS}
        onChange={onChange}
        ariaLabel="Pick a value"
        testId="picker"
      />,
    );
    const trigger = screen.getByTestId("picker");
    await user.click(trigger);
    await user.keyboard("{ArrowDown}");
    await user.keyboard(" ");
    expect(onChange).toHaveBeenCalledWith("beta");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await user.tab();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});
