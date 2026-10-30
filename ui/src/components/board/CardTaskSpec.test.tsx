import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CardTaskSpec } from "@/components/board/CardTaskSpec";
import { I18nProvider } from "@/i18n";

function renderSpec(props: Partial<Parameters<typeof CardTaskSpec>[0]> = {}) {
  return render(
    <I18nProvider>
      <CardTaskSpec {...props} />
    </I18nProvider>,
  );
}

describe("CardTaskSpec (TASK-157)", () => {
  it("renders nothing without a task spec", () => {
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
});
