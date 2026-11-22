import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CardTaskSpec } from "@/components/board/CardTaskSpec";
import { I18nProvider } from "@/i18n";
import { canEditCardTaskSpec } from "@/utils/card-permissions";

const setCardTaskSpec = vi.hoisted(() => vi.fn());

vi.mock("@/store/BoardContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/store/BoardContext")>();
  return {
    ...actual,
    useBoardActions: () => ({ setCardTaskSpec }),
  };
});

function renderSpec(props: Partial<Parameters<typeof CardTaskSpec>[0]> = {}) {
  return render(
    <I18nProvider>
      <CardTaskSpec cardId="card-1" {...props} />
    </I18nProvider>,
  );
}

describe("CardTaskSpec (TASK-157)", () => {
  beforeEach(() => setCardTaskSpec.mockClear());

  it("renders nothing without a task spec and without edit permission", () => {
    renderSpec();
    expect(screen.queryByTestId("card-task-spec")).toBeNull();
  });

  it("renders the acceptance criteria and definition of done", () => {
    renderSpec({
      acceptanceCriteria: ["runs", "passes CI"],
      definitionOfDone: ["tests green"],
    });
    expect(screen.getByTestId("card-task-spec")).toBeInTheDocument();
    expect(screen.getByTestId("card-task-spec-acceptance")).toHaveTextContent(
      "runs",
    );
    expect(screen.getByTestId("card-task-spec-done")).toHaveTextContent(
      "tests green",
    );
  });

  it("renders only the field that is present", () => {
    renderSpec({ acceptanceCriteria: ["only criteria"] });
    expect(screen.getByTestId("card-task-spec-acceptance")).toBeInTheDocument();
    expect(screen.queryByTestId("card-task-spec-done")).toBeNull();
  });

  it("offers an Add control on an empty editable card and saves both lists", () => {
    renderSpec({ canEdit: true });
    expect(screen.getByTestId("card-task-spec-empty")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("card-task-spec-edit"));

    fireEvent.change(screen.getByTestId("card-task-spec-criteria-input"), {
      target: { value: "runs\npasses CI\n" },
    });
    fireEvent.change(screen.getByTestId("card-task-spec-done-input"), {
      target: { value: "tests green" },
    });
    fireEvent.click(screen.getByTestId("card-task-spec-save"));

    expect(setCardTaskSpec).toHaveBeenCalledWith("card-1", {
      acceptanceCriteria: ["runs", "passes CI"],
      definitionOfDone: ["tests green"],
    });
  });

  it("clears the contract only after confirmation", () => {
    renderSpec({
      acceptanceCriteria: ["old"],
      definitionOfDone: ["old done"],
      canEdit: true,
    });
    fireEvent.click(screen.getByTestId("card-task-spec-clear"));
    expect(setCardTaskSpec).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear" }));

    expect(setCardTaskSpec).toHaveBeenCalledWith("card-1", {
      acceptanceCriteria: [],
      definitionOfDone: [],
    });
  });

  it("focuses the first field and Escape cancels the edit", () => {
    renderSpec({
      acceptanceCriteria: ["old"],
      definitionOfDone: ["old done"],
      canEdit: true,
    });
    fireEvent.click(screen.getByTestId("card-task-spec-edit"));

    expect(screen.getByTestId("card-task-spec-criteria-input")).toHaveFocus();
    fireEvent.keyDown(screen.getByTestId("card-task-spec-form"), {
      key: "Escape",
    });

    expect(screen.queryByTestId("card-task-spec-form")).toBeNull();
    expect(setCardTaskSpec).not.toHaveBeenCalled();
  });

  it("keeps the read-only surface free of edit controls", () => {
    renderSpec({
      acceptanceCriteria: ["old"],
      definitionOfDone: ["old done"],
    });
    expect(screen.queryByTestId("card-task-spec-edit")).toBeNull();
    expect(screen.queryByTestId("card-task-spec-clear")).toBeNull();
  });

  it("rejects an over-long item without dispatching", () => {
    renderSpec({ canEdit: true });
    fireEvent.click(screen.getByTestId("card-task-spec-edit"));
    fireEvent.change(screen.getByTestId("card-task-spec-done-input"), {
      target: { value: "x".repeat(501) },
    });
    fireEvent.click(screen.getByTestId("card-task-spec-save"));

    expect(screen.getByTestId("card-task-spec-error")).toBeInTheDocument();
    expect(setCardTaskSpec).not.toHaveBeenCalled();
  });
});

describe("canEditCardTaskSpec (TASK-177.4 decision 1)", () => {
  it("allows ADMIN and MEMBER on a writable card", () => {
    expect(canEditCardTaskSpec("ADMIN", false)).toBe(true);
    expect(canEditCardTaskSpec("MEMBER", false)).toBe(true);
  });

  it("denies VIEWER, an unresolved role and a read-only mount", () => {
    expect(canEditCardTaskSpec("VIEWER", false)).toBe(false);
    expect(canEditCardTaskSpec(undefined, false)).toBe(false);
    expect(canEditCardTaskSpec("ADMIN", true)).toBe(false);
    expect(canEditCardTaskSpec("MEMBER", true)).toBe(false);
  });
});
