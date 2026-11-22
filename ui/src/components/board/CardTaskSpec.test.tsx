import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CardTaskSpec } from "@/components/board/CardTaskSpec";
import { ToastProvider } from "@/components/Toast";
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
      <ToastProvider>
        <CardTaskSpec cardId="card-1" {...props} />
      </ToastProvider>
    </I18nProvider>,
  );
}

function rerenderSpec(
  rerender: ReturnType<typeof render>["rerender"],
  props: Partial<Parameters<typeof CardTaskSpec>[0]> = {},
) {
  rerender(
    <I18nProvider>
      <ToastProvider>
        <CardTaskSpec cardId="card-1" {...props} />
      </ToastProvider>
    </I18nProvider>,
  );
}

describe("CardTaskSpec (TASK-157)", () => {
  beforeEach(() => setCardTaskSpec.mockClear());

  it("renders nothing without a task spec and without edit permission", () => {
    renderSpec();
    expect(screen.queryByTestId("card-task-spec")).toBeNull();
  });

  it("renders the named lists and wraps long unbroken items", () => {
    const longItem = "sha256:" + "a".repeat(493);
    renderSpec({
      acceptanceCriteria: ["runs", "passes CI"],
      definitionOfDone: [longItem],
    });
    expect(screen.getByTestId("card-task-spec")).toBeInTheDocument();
    const criteria = screen.getByRole("list", { name: "Acceptance criteria" });
    expect(criteria).toHaveTextContent("runs");
    const done = screen.getByRole("list", { name: "Definition of done" });
    expect(done).toHaveTextContent(longItem);
    expect(within(done).getByText(longItem)).toHaveClass(
      "break-words",
      "[overflow-wrap:anywhere]",
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

    expect(screen.getByTestId("card-task-spec-form")).toHaveAttribute(
      "novalidate",
    );
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

  it("saves an unchanged draft as a no-op", () => {
    renderSpec({
      acceptanceCriteria: ["runs"],
      definitionOfDone: ["tests green"],
      canEdit: true,
    });
    fireEvent.click(screen.getByTestId("card-task-spec-edit"));
    fireEvent.click(screen.getByTestId("card-task-spec-save"));

    expect(screen.queryByTestId("card-task-spec-form")).toBeNull();
    expect(setCardTaskSpec).not.toHaveBeenCalled();
  });

  it("sends only the list the human changed when the other prop moved (race)", () => {
    const { rerender } = renderSpec({
      acceptanceCriteria: ["old criteria"],
      definitionOfDone: ["agent v1"],
      canEdit: true,
    });
    fireEvent.click(screen.getByTestId("card-task-spec-edit"));
    fireEvent.change(screen.getByTestId("card-task-spec-criteria-input"), {
      target: { value: "human criteria" },
    });

    // A concurrent agent rewrote the DoD after this editor opened.
    rerenderSpec(rerender, {
      acceptanceCriteria: ["old criteria"],
      definitionOfDone: ["agent v2"],
      canEdit: true,
    });
    fireEvent.click(screen.getByTestId("card-task-spec-save"));

    expect(setCardTaskSpec).toHaveBeenCalledWith("card-1", {
      acceptanceCriteria: ["human criteria"],
    });
  });

  it("confirms when saving both lists empty", () => {
    renderSpec({
      acceptanceCriteria: ["old"],
      definitionOfDone: ["old done"],
      canEdit: true,
    });
    fireEvent.click(screen.getByTestId("card-task-spec-edit"));
    fireEvent.change(screen.getByTestId("card-task-spec-criteria-input"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByTestId("card-task-spec-done-input"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByTestId("card-task-spec-save"));

    const dialog = screen.getByRole("dialog", {
      name: "Clear the task spec?",
    });
    expect(setCardTaskSpec).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear" }));

    expect(setCardTaskSpec).toHaveBeenCalledWith("card-1", {
      acceptanceCriteria: [],
      definitionOfDone: [],
    });
  });

  it("clears the contract only after confirmation and focuses Edit", async () => {
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
    await waitFor(() =>
      expect(screen.getByTestId("card-task-spec-edit")).toHaveFocus(),
    );
  });

  it("returns focus to Clear when the confirmation is cancelled", async () => {
    renderSpec({
      acceptanceCriteria: ["old"],
      definitionOfDone: ["old done"],
      canEdit: true,
    });
    const clear = screen.getByTestId("card-task-spec-clear");
    fireEvent.click(clear);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(clear).toHaveFocus());
    expect(setCardTaskSpec).not.toHaveBeenCalled();
  });

  it("focuses the first field when the editor opens", () => {
    renderSpec({
      acceptanceCriteria: ["old"],
      definitionOfDone: ["old done"],
      canEdit: true,
    });
    fireEvent.click(screen.getByTestId("card-task-spec-edit"));
    expect(screen.getByTestId("card-task-spec-criteria-input")).toHaveFocus();
  });

  it("keeps the draft and warns when collapsing the section while editing", () => {
    renderSpec({
      acceptanceCriteria: ["old"],
      definitionOfDone: ["old done"],
      canEdit: true,
    });
    fireEvent.click(screen.getByTestId("card-task-spec-edit"));
    fireEvent.change(screen.getByTestId("card-task-spec-criteria-input"), {
      target: { value: "draft" },
    });
    fireEvent.click(screen.getByTestId("card-task-spec"));

    expect(screen.getByTestId("card-task-spec-form")).toBeInTheDocument();
    expect(screen.getByTestId("card-task-spec-criteria-input")).toHaveValue(
      "draft",
    );
    expect(
      screen.getByText("Save or cancel the task spec before collapsing it."),
    ).toBeInTheDocument();
  });

  it("keeps the read-only surface free of edit controls", () => {
    renderSpec({
      acceptanceCriteria: ["old"],
      definitionOfDone: ["old done"],
    });
    expect(screen.queryByTestId("card-task-spec-edit")).toBeNull();
    expect(screen.queryByTestId("card-task-spec-clear")).toBeNull();
  });

  it("rejects an over-long item without dispatching and focuses the field", () => {
    renderSpec({ canEdit: true });
    fireEvent.click(screen.getByTestId("card-task-spec-edit"));
    const done = screen.getByTestId("card-task-spec-done-input");
    fireEvent.change(done, { target: { value: "x".repeat(501) } });
    fireEvent.click(screen.getByTestId("card-task-spec-save"));

    expect(screen.getByTestId("card-task-spec-error")).toBeInTheDocument();
    expect(done).toHaveAttribute("aria-invalid", "true");
    expect(done).toHaveAttribute(
      "aria-describedby",
      "card-task-spec-hint-card-1 card-task-spec-done-error-card-1",
    );
    expect(done).toHaveFocus();
    expect(setCardTaskSpec).not.toHaveBeenCalled();
  });

  it("rejects too many items and focuses the offending list", () => {
    renderSpec({ canEdit: true });
    fireEvent.click(screen.getByTestId("card-task-spec-edit"));
    const criteria = screen.getByTestId("card-task-spec-criteria-input");
    fireEvent.change(criteria, {
      target: {
        value: Array.from({ length: 51 }, (_, index) => `item ${index}`).join(
          "\n",
        ),
      },
    });
    fireEvent.click(screen.getByTestId("card-task-spec-save"));

    expect(screen.getByTestId("card-task-spec-error")).toHaveTextContent(
      "Use at most 50 items per list.",
    );
    expect(criteria).toHaveAttribute("aria-invalid", "true");
    expect(criteria).toHaveFocus();
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
