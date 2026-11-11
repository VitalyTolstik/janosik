import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkflowEditor } from "@/components/board/WorkflowEditor";
import { I18nProvider } from "@/i18n";
import type { BoardWorkflow, Card, Column } from "@janosik/shared";

const columns: Column[] = [
  { id: "backlog", title: "Backlog", cardIds: ["c1"], createdAt: 1 },
  { id: "doing", title: "Doing", cardIds: [], createdAt: 1 },
  { id: "done", title: "Done", cardIds: [], createdAt: 1 },
];

const cards: Record<string, Card> = {
  c1: { id: "c1", title: "Task", labelIds: [], createdAt: 1, updatedAt: 1 },
};

const workflow: BoardWorkflow = {
  schemaVersion: 1,
  enabled: true,
  initialColumnId: "backlog",
  doneColumnIds: ["done"],
  transitions: [{ id: "tr-1", fromColumnId: "backlog", toColumnId: "doing" }],
};

function setup(
  value: BoardWorkflow | undefined = workflow,
  options: { canEdit?: boolean; workflowInvalid?: boolean } = {},
) {
  const onSave = vi.fn();
  const view = (next: BoardWorkflow | undefined) => (
    <I18nProvider>
      <WorkflowEditor
        columns={columns}
        cards={cards}
        workflow={next}
        workflowInvalid={options.workflowInvalid}
        canEdit={options.canEdit ?? true}
        onSave={onSave}
      />
    </I18nProvider>
  );
  const { rerender } = render(view(value));
  return {
    onSave,
    rerender: (next: BoardWorkflow | undefined) => rerender(view(next)),
  };
}

/** The matrix is a secondary tab now; every cell test opens it first. */
function openMatrix() {
  fireEvent.click(screen.getByTestId("workflow-tab-matrix"));
}

describe("WorkflowEditor", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows the saved matrix and saves an edited transition", () => {
    const { onSave } = setup();
    openMatrix();
    expect(screen.getByTestId("workflow-cell-backlog-doing")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByTestId("workflow-cell-backlog-done"));
    // Selecting the new edge opens the inspector; add the checklist condition.
    fireEvent.click(
      screen.getByTestId("workflow-condition-requireChecklistsDone"),
    );
    fireEvent.click(screen.getByTestId("workflow-save"));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as BoardWorkflow;
    expect(saved.transitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromColumnId: "backlog",
          toColumnId: "done",
          conditions: ["requireChecklistsDone"],
        }),
      ]),
    );
  });

  it("blocks saving an enabled workflow without transitions", () => {
    setup({ ...workflow, transitions: [] });
    expect(screen.getByTestId("workflow-save")).toBeDisabled();
    expect(screen.getByTestId("workflow-error")).toHaveTextContent(
      "at least one active transition",
    );
  });

  it("blocks saving an enabled workflow whose only edges are disabled", () => {
    setup({
      ...workflow,
      transitions: workflow.transitions.map((transition) => ({
        ...transition,
        enabled: false,
      })),
    });
    expect(screen.getByTestId("workflow-save")).toBeDisabled();
    expect(screen.getByTestId("workflow-error")).toHaveTextContent(
      "at least one active transition",
    );
  });

  it("blocks a duplicate global target before the server sees it", () => {
    setup({
      ...workflow,
      transitions: [
        ...workflow.transitions,
        { id: "g1", fromColumnId: null, toColumnId: "done" },
        { id: "g2", fromColumnId: null, toColumnId: "done" },
      ],
    });
    expect(screen.getByTestId("workflow-save")).toBeDisabled();
    expect(screen.getByTestId("workflow-error")).toHaveTextContent(
      "global transitions",
    );
  });

  it("re-enables a disabled edge on one click, as the cell hint promises", () => {
    setup({
      ...workflow,
      transitions: [{ ...workflow.transitions[0], enabled: false }],
    });
    openMatrix();
    const cell = screen.getByTestId("workflow-cell-backlog-doing");
    expect(cell).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(cell);
    expect(cell).toHaveAttribute("aria-pressed", "true");
  });

  it("warns and offers a reload when the workflow changes elsewhere", () => {
    const { rerender } = setup();
    rerender({
      ...workflow,
      transitions: [
        { id: "tr-2", fromColumnId: "backlog", toColumnId: "done" },
      ],
    });
    expect(screen.getByTestId("workflow-foreign-change")).toBeVisible();
    fireEvent.click(screen.getByTestId("workflow-reload"));
    expect(
      screen.queryByTestId("workflow-foreign-change"),
    ).not.toBeInTheDocument();
  });

  it("marks a stored config that failed validation", () => {
    setup({ ...workflow, transitions: [] }, { workflowInvalid: true });
    expect(screen.getByTestId("workflow-invalid")).toHaveTextContent(
      "stored workflow is invalid",
    );
  });

  it("fills the template with forward and reverse adjacent transitions", () => {
    const { onSave } = setup(undefined);
    fireEvent.pointerDown(screen.getByTestId("workflow-more"), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click(screen.getByTestId("workflow-template"));
    fireEvent.click(screen.getByTestId("workflow-save"));
    const saved = onSave.mock.calls[0][0] as BoardWorkflow;
    expect(
      saved.transitions.map((entry) => [entry.fromColumnId, entry.toColumnId]),
    ).toEqual([
      ["backlog", "doing"],
      ["doing", "backlog"],
      ["doing", "done"],
      ["done", "doing"],
    ]);
  });

  it("keeps the reverse checkbox in sync with the mirror edge", () => {
    setup();
    openMatrix();
    fireEvent.click(screen.getByTestId("workflow-cell-backlog-doing"));
    expect(screen.getByTestId("workflow-reverse")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    fireEvent.click(screen.getByTestId("workflow-reverse"));
    expect(screen.getByTestId("workflow-cell-doing-backlog")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByTestId("workflow-reverse"));
    expect(screen.getByTestId("workflow-cell-doing-backlog")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("renders a read-only editor when the caller is not an ADMIN", () => {
    render(
      <I18nProvider>
        <WorkflowEditor
          columns={columns}
          cards={cards}
          workflow={workflow}
          canEdit={false}
          onSave={vi.fn()}
        />
      </I18nProvider>,
    );
    openMatrix();
    expect(screen.getByTestId("workflow-save")).toBeDisabled();
    expect(screen.getByTestId("workflow-cell-backlog-done")).toBeDisabled();
  });
});
