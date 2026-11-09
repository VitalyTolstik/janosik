import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

function setup(value: BoardWorkflow | undefined = workflow) {
  const onSave = vi.fn();
  render(
    <I18nProvider>
      <WorkflowEditor
        columns={columns}
        cards={cards}
        workflow={value}
        canEdit
        onSave={onSave}
      />
    </I18nProvider>,
  );
  return { onSave };
}

describe("WorkflowEditor", () => {
  it("shows the saved matrix and saves an edited transition", () => {
    const { onSave } = setup();
    expect(screen.getByTestId("workflow-cell-backlog-doing")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByTestId("workflow-cell-backlog-done"));
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

  it("fills the template with forward and reverse adjacent transitions", () => {
    const { onSave } = setup(undefined);
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
    expect(screen.getByTestId("workflow-save")).toBeDisabled();
    expect(screen.getByTestId("workflow-cell-backlog-done")).toBeDisabled();
  });
});
