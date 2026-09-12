import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FilterBar } from "@/components/board/FilterBar";
import { I18nProvider } from "@/i18n";
import type { Label } from "@/types/kanban";
import { EMPTY_FILTER, type CardFilter } from "@/utils/filter";

/**
 * The faceted filters (due date, labels, creation date) live behind a single
 * "Filters" popover button; the due facet reuses the TASK-4 status model
 * (overdue / soon ≤24 h / no due date).
 */

const LABELS: Label[] = [
  { id: "l1", name: "Bug", color: "red" },
  { id: "l2", name: "Feature", color: "blue" },
];

function renderBar(filter: CardFilter = EMPTY_FILTER) {
  const onChange = vi.fn();
  render(
    <I18nProvider>
      <FilterBar
        filter={filter}
        labels={LABELS}
        matchCount={3}
        onChange={onChange}
      />
    </I18nProvider>,
  );
  return onChange;
}

describe("FilterBar", () => {
  it("keeps the search input inline and the facets behind the popover", async () => {
    renderBar();
    expect(
      screen.getByLabelText("Search cards", { selector: "input" }),
    ).toBeInTheDocument();

    // Facet options are not rendered until the popover opens.
    expect(screen.queryByText("Overdue")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Filter cards" }));
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    expect(screen.getByText("Feature")).toBeInTheDocument();
  });

  it("selects a due status from the popover", async () => {
    const onChange = renderBar();
    await userEvent.click(screen.getByRole("button", { name: "Filter cards" }));
    await userEvent.click(screen.getByRole("radio", { name: "Overdue" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_FILTER, due: "overdue" });
  });

  it("toggles a label checkbox from the popover", async () => {
    const onChange = renderBar();
    await userEvent.click(screen.getByRole("button", { name: "Filter cards" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Bug" }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...EMPTY_FILTER,
      labelIds: ["l1"],
    });
  });

  it("switches the label match mode between any and all", async () => {
    const onChange = renderBar();
    await userEvent.click(screen.getByRole("button", { name: "Filter cards" }));
    const group = screen.getByRole("radiogroup", { name: "Label match mode" });
    expect(group).toHaveTextContent("Any");
    expect(group).toHaveTextContent("All");
    await userEvent.click(screen.getByRole("radio", { name: "All" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_FILTER, labelMatch: "all" });
  });

  it("shows the active facet count on the filters button", () => {
    renderBar({ ...EMPTY_FILTER, due: "soon", labelIds: ["l1"] });
    expect(screen.getByRole("button", { name: "Filter cards" })).toHaveTextContent(
      "2",
    );
  });

  it("renders removable chips for the active facets", async () => {
    const onChange = renderBar({
      ...EMPTY_FILTER,
      due: "overdue",
      noLabel: true,
    });

    expect(screen.getByText("Overdue")).toBeInTheDocument();
    await userEvent.click(
      screen.getAllByRole("button", { name: "Remove label" })[0],
    );
    expect(onChange).toHaveBeenLastCalledWith({
      ...EMPTY_FILTER,
      due: "any",
      noLabel: true,
    });
  });
});
