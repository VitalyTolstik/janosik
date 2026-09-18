import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CollapsibleSection } from "@/components/board/CollapsibleSection";

/**
 * The shared card-section header (TASK-44): description, checklists and
 * activity all open and close through this one component, so its contract
 * (defaults, badge, trailing action) is asserted directly.
 */

describe("CollapsibleSection (TASK-44)", () => {
  it("starts expanded by default and toggles the content", () => {
    render(
      <CollapsibleSection title="Description" testId="section-toggle">
        <p>Body</p>
      </CollapsibleSection>,
    );

    const toggle = screen.getByTestId("section-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Body")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Body")).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Body")).toBeInTheDocument();
  });

  it("can start collapsed and keeps badge and action visible", () => {
    render(
      <CollapsibleSection
        title="Activity"
        badge={3}
        defaultExpanded={false}
        action={<button type="button">Add</button>}
        testId="section-toggle"
      >
        <p>Body</p>
      </CollapsibleSection>,
    );

    expect(screen.queryByText("Body")).toBeNull();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  });
});
