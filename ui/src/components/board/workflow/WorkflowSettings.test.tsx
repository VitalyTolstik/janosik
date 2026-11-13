import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardWorkflow, Card, Column } from "@janosik/shared";

import { WorkflowSettings } from "@/components/board/workflow/WorkflowSettings";
import type { WorkflowSave } from "@/components/board/workflow/useWorkflowDraft";
import { I18nProvider } from "@/i18n";

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

const columns: Column[] = [
  { id: "ideas", title: "Ideas", cardIds: [], createdAt: 1 },
  { id: "backlog", title: "Backlog", cardIds: ["c1"], createdAt: 1 },
  { id: "doing", title: "Doing", cardIds: ["c2"], createdAt: 1 },
  { id: "review", title: "Review", cardIds: [], createdAt: 1 },
  { id: "done", title: "Done", cardIds: [], createdAt: 1 },
];

const cards: Record<string, Card> = {
  c1: {
    id: "c1",
    title: "First task",
    labelIds: [],
    createdAt: 1,
    updatedAt: 1,
  },
  c2: {
    id: "c2",
    title: "Onboarding: empty state",
    labelIds: [],
    createdAt: 1,
    updatedAt: 1,
  },
};

const workflow: BoardWorkflow = {
  schemaVersion: 1,
  enabled: true,
  initialColumnId: "backlog",
  doneColumnIds: ["done"],
  transitions: [
    { id: "ideas-backlog", fromColumnId: "ideas", toColumnId: "backlog" },
    {
      id: "doing-backlog",
      fromColumnId: "doing",
      toColumnId: "backlog",
      allowedRoles: ["ADMIN"],
    },
    {
      id: "doing-review",
      fromColumnId: "doing",
      toColumnId: "review",
      conditions: ["requireAssignee", "requireDueDate"],
    },
    { id: "review-done", fromColumnId: "review", toColumnId: "done" },
    {
      id: "global-backlog",
      fromColumnId: null,
      toColumnId: "backlog",
      allowedRoles: ["ADMIN", "MEMBER"],
    },
    {
      id: "global-done",
      fromColumnId: null,
      toColumnId: "done",
      allowedRoles: ["ADMIN"],
    },
  ],
};

function renderEditor(
  options: {
    value?: BoardWorkflow;
    saveResult?: boolean;
    canEdit?: boolean;
    columns?: Column[];
  } = {},
) {
  const onSave = vi.fn<WorkflowSave>(() => options.saveResult ?? true);
  render(
    <I18nProvider>
      <WorkflowSettings
        columns={options.columns ?? columns}
        cards={cards}
        workflow={options.value ?? workflow}
        canEdit={options.canEdit ?? true}
        onSave={onSave}
        variant="embedded"
      />
    </I18nProvider>,
  );
  return onSave;
}

describe("WorkflowSettings rail", () => {
  beforeEach(() => {
    localStorage.clear();
    // jsdom has no layout, so scrollIntoView is absent. The rail calls it to
    // keep the selected tab reachable; every test gets a fresh spy.
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  });

  it("opens the busiest source column and its first forward rule", () => {
    renderEditor();
    expect(screen.getByText("Allowed from “Doing”")).toBeVisible();
    expect(screen.getByTestId("workflow-inspector-title")).toHaveTextContent(
      "Doing→Review",
    );
    expect(screen.getByTestId("workflow-rules-count")).toHaveTextContent(
      "2 of 4",
    );
    expect(screen.getByTestId("workflow-row-backlog")).toHaveTextContent(
      "ADMIN · ADMIN only",
    );
  });

  it("switches columns from the rail and follows with the keyboard", () => {
    renderEditor();
    fireEvent.click(screen.getByTestId("workflow-rail-review"));
    expect(screen.getByText("Allowed from “Review”")).toBeVisible();
    expect(screen.getByTestId("workflow-inspector-title")).toHaveTextContent(
      "Review→Done",
    );

    const review = screen.getByTestId("workflow-rail-review");
    review.focus();
    expect(review).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(review, { key: "ArrowRight" });
    expect(screen.getByTestId("workflow-rail-done")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(document.activeElement).toBe(
      screen.getByTestId("workflow-rail-done"),
    );
  });

  it("keeps the last of many columns reachable with End and Arrow", () => {
    const manyColumns: Column[] = [
      ...columns,
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `extra-${index}`,
        title: `Extra ${index}`,
        cardIds: [],
        createdAt: 1,
      })),
    ];
    renderEditor({ columns: manyColumns });
    const scrollIntoView = vi.mocked(HTMLElement.prototype.scrollIntoView);
    scrollIntoView.mockClear();

    const first = screen.getByTestId("workflow-rail-ideas");
    first.focus();
    fireEvent.keyDown(first, { key: "End" });
    const last = screen.getByTestId(
      `workflow-rail-${manyColumns[manyColumns.length - 1]?.id}`,
    );
    expect(last).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(last);
    expect(scrollIntoView).toHaveBeenLastCalledWith({
      inline: "nearest",
      block: "nearest",
    });
    expect(scrollIntoView.mock.instances.at(-1)).toBe(last);

    scrollIntoView.mockClear();
    fireEvent.keyDown(last, { key: "ArrowLeft" });
    const penultimate = screen.getByTestId(
      `workflow-rail-${manyColumns[manyColumns.length - 2]?.id}`,
    );
    expect(penultimate).toHaveAttribute("aria-selected", "true");
    expect(scrollIntoView).toHaveBeenCalledWith({
      inline: "nearest",
      block: "nearest",
    });

    scrollIntoView.mockClear();
    fireEvent.keyDown(penultimate, { key: "ArrowRight" });
    expect(last).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(last);
    expect(scrollIntoView).toHaveBeenCalledWith({
      inline: "nearest",
      block: "nearest",
    });
    expect(scrollIntoView.mock.instances.at(-1)).toBe(last);

    scrollIntoView.mockClear();
    fireEvent.keyDown(last, { key: "Home" });
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(first);
    expect(scrollIntoView).toHaveBeenCalledWith({
      inline: "nearest",
      block: "nearest",
    });
    expect(scrollIntoView.mock.instances.at(-1)).toBe(first);
  });

  it("toggles a rule from its row switch and saves the disabled edge", () => {
    const onSave = renderEditor();
    const toggle = screen.getByTestId("workflow-row-switch-review");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByTestId("workflow-save"));
    const saved = onSave.mock.calls[0][0] as BoardWorkflow;
    expect(
      saved.transitions.find((entry) => entry.id === "doing-review"),
    ).toMatchObject({ enabled: false });
  });

  it("allows a missing destination and opens it in the inspector", () => {
    const onSave = renderEditor();
    fireEvent.click(screen.getByTestId("workflow-allow-ideas"));
    expect(screen.getByTestId("workflow-inspector-title")).toHaveTextContent(
      "Doing→Ideas",
    );
    fireEvent.click(screen.getByTestId("workflow-save"));
    const saved = onSave.mock.calls[0][0] as BoardWorkflow;
    expect(saved.transitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromColumnId: "doing",
          toColumnId: "ideas",
          allowedRoles: ["ADMIN", "MEMBER"],
        }),
      ]),
    );
  });

  it("edits roles, conditions and the reverse edge in the inspector", () => {
    const onSave = renderEditor();
    fireEvent.click(screen.getByTestId("workflow-role-MEMBER"));
    expect(screen.getByTestId("workflow-role-MEMBER")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    fireEvent.click(
      screen.getByTestId("workflow-condition-requireDescription"),
    );
    fireEvent.click(screen.getByTestId("workflow-reverse"));
    fireEvent.click(screen.getByTestId("workflow-save"));

    const saved = onSave.mock.calls[0][0] as BoardWorkflow;
    expect(
      saved.transitions.find((entry) => entry.id === "doing-review"),
    ).toMatchObject({
      allowedRoles: ["ADMIN"],
      conditions: ["requireAssignee", "requireDueDate", "requireDescription"],
    });
    expect(saved.transitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromColumnId: "review",
          toColumnId: "doing",
        }),
      ]),
    );
  });

  it("adds a global transition from the strip", () => {
    const onSave = renderEditor();
    fireEvent.pointerDown(screen.getByTestId("workflow-global-add"), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click(screen.getByTestId("workflow-global-add-ideas"));
    expect(screen.getByTestId("workflow-inspector-title")).toHaveTextContent(
      "Any→Ideas",
    );
    fireEvent.click(screen.getByTestId("workflow-save"));
    const saved = onSave.mock.calls[0][0] as BoardWorkflow;
    expect(saved.transitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromColumnId: null,
          toColumnId: "ideas",
        }),
      ]),
    );
  });

  it("edits start and done semantics", () => {
    const onSave = renderEditor();
    fireEvent.click(screen.getByTestId("workflow-initial"));
    fireEvent.click(screen.getByTestId("workflow-initial-option-ideas"));
    fireEvent.click(screen.getByTestId("workflow-done-review"));
    fireEvent.click(screen.getByTestId("workflow-save"));
    const saved = onSave.mock.calls[0][0] as BoardWorkflow;
    expect(saved.initialColumnId).toBe("ideas");
    expect(saved.doneColumnIds).toEqual(["done", "review"]);
  });

  it("keeps exactly one matrix cell in the tab order and navigates with arrows", () => {
    renderEditor();
    fireEvent.click(screen.getByTestId("workflow-tab-matrix"));
    expect(screen.getByTestId("workflow-matrix-grid")).toBeVisible();
    const cells = screen.getAllByTestId(/^workflow-cell-/);
    expect(
      cells.filter((cell) => cell.getAttribute("tabindex") === "0"),
    ).toHaveLength(1);

    const start = screen.getByTestId("workflow-cell-doing-review");
    act(() => start.focus());
    fireEvent.keyDown(start, { key: "ArrowRight" });
    expect(document.activeElement).toBe(
      screen.getByTestId("workflow-cell-doing-done"),
    );
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: " " });
    expect(screen.getByTestId("workflow-cell-doing-done")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("navigates the rule list with arrows, Space and Enter", () => {
    const onSave = renderEditor();
    const backlog = screen.getByTestId("workflow-row-main-backlog");
    backlog.focus();
    fireEvent.keyDown(backlog, { key: " " });
    expect(screen.getByTestId("workflow-row-switch-backlog")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    fireEvent.keyDown(backlog, { key: "ArrowDown" });
    expect(document.activeElement).toBe(
      screen.getByTestId("workflow-row-main-review"),
    );
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Enter" });
    expect(screen.getByTestId("workflow-inspector-title")).toHaveTextContent(
      "Doing→Review",
    );
    fireEvent.click(screen.getByTestId("workflow-save"));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("shows dirty status and a save error without dropping the draft", async () => {
    renderEditor({ saveResult: false });
    expect(screen.getByTestId("workflow-dirty")).toHaveTextContent(
      "All changes saved",
    );
    fireEvent.click(screen.getByTestId("workflow-allow-ideas"));
    expect(screen.getByTestId("workflow-dirty")).toHaveTextContent(
      "Unsaved changes",
    );
    fireEvent.click(screen.getByTestId("workflow-save"));
    await waitFor(() =>
      expect(screen.getByTestId("workflow-save-error")).toBeVisible(),
    );
    expect(screen.getByTestId("workflow-dirty")).toHaveTextContent(
      "Save failed",
    );
    expect(screen.getByTestId("workflow-inspector-title")).toHaveTextContent(
      "Doing→Ideas",
    );
  });

  it("restores the last view from localStorage", () => {
    localStorage.setItem("janosik.workflow.view", "matrix");
    renderEditor();
    expect(screen.getByTestId("workflow-matrix-grid")).toBeVisible();
    expect(screen.getByTestId("workflow-tab-matrix")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("keeps the inspector read-only when the caller cannot edit", () => {
    renderEditor({ canEdit: false });
    expect(screen.getByTestId("workflow-save")).toBeDisabled();
    expect(screen.getByTestId("workflow-role-MEMBER")).toBeDisabled();
    expect(screen.getByTestId("workflow-row-switch-review")).toBeDisabled();
  });
});
