import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { BoardScopeSelect } from "@/components/agents/BoardScopeSelect";
import { I18nProvider } from "@/i18n";

const BOARDS = [
  { id: "board-1", title: "Website Relaunch" },
  { id: "board-2", title: "Agent Ops Demo" },
];

function renderScope(onChange = vi.fn()) {
  render(
    <I18nProvider>
      <BoardScopeSelect
        value="all"
        boards={BOARDS}
        onChange={onChange}
        ariaLabel="Board scope"
        testId="scope"
        variant="filter"
      />
    </I18nProvider>,
  );
  return { trigger: screen.getByTestId("scope"), onChange };
}

describe("BoardScopeSelect (TASK-179.9)", () => {
  it("uses a custom combobox with an opaque option list", async () => {
    const user = userEvent.setup();
    const { trigger } = renderScope();
    expect(trigger).toHaveAttribute("role", "combobox");
    expect(document.querySelector("select")).toBeNull();

    await user.click(trigger);
    const listbox = screen.getByTestId("scope-listbox");
    const popover = screen.getByTestId("scope-popover");
    expect(listbox).toHaveAttribute("role", "listbox");
    expect(popover.className).toContain("bg-popover");
    expect(popover.className).toContain("z-[70]");
    expect(popover.style.pointerEvents).toBe("auto");
    expect(trigger).toHaveAttribute("aria-controls", listbox.id);
  });

  it("navigates boards with Arrow/Home/End and selects with Enter", async () => {
    const user = userEvent.setup();
    const { trigger, onChange } = renderScope();
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const listbox = screen.getByTestId("scope-listbox");
    expect(trigger).toHaveAttribute(
      "aria-activedescendant",
      `${listbox.id}-option-0`,
    );

    await user.keyboard("{ArrowDown}");
    expect(trigger).toHaveAttribute(
      "aria-activedescendant",
      `${listbox.id}-option-1`,
    );
    await user.keyboard("{End}");
    expect(trigger).toHaveAttribute(
      "aria-activedescendant",
      `${listbox.id}-option-2`,
    );
    await user.keyboard("{Home}");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("board-1");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    const { trigger } = renderScope();
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it("keeps 36 px desktop rows and 44 px mobile rows", async () => {
    const user = userEvent.setup();
    const { trigger } = renderScope();
    await user.click(trigger);
    const option = screen.getByTestId("scope-option-board-1");
    expect(option.className).toContain("min-h-9");
    expect(option.className).toContain("max-md:min-h-11");
  });

  it("typeaheads board titles", async () => {
    const user = userEvent.setup();
    const { trigger, onChange } = renderScope();
    await user.click(trigger);
    await user.keyboard("w");
    const listbox = screen.getByTestId("scope-listbox");
    expect(trigger).toHaveAttribute(
      "aria-activedescendant",
      `${listbox.id}-option-1`,
    );
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("board-1");
  });
});
