import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CardComposer } from "@/components/board/CardComposer";
import { I18nProvider } from "@/i18n";
import type { Label } from "@/types/kanban";

const labels: Label[] = [
  { id: "l1", name: "Design", color: "brand" },
  { id: "l2", name: "Urgent", color: "red" },
];

function renderComposer() {
  const onSubmit = vi.fn();
  render(
    <I18nProvider>
      <CardComposer labels={labels} onSubmit={onSubmit} />
    </I18nProvider>,
  );
  return onSubmit;
}

function openAndType(text: string) {
  fireEvent.click(screen.getByRole("button", { name: /Add a card/i }));
  const textbox = screen.getByPlaceholderText(/Enter a title/i);
  fireEvent.change(textbox, { target: { value: text } });
  return textbox;
}

describe("CardComposer", () => {
  it("offers board labels as toggle chips while composing", () => {
    renderComposer();
    // Idle state: no labels yet — they appear only while composing.
    expect(screen.queryByTestId("composer-labels")).toBeNull();
    openAndType("");
    expect(screen.getByTestId("composer-labels")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Design" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Urgent" })).toBeInTheDocument();
  });

  it("passes the picked label ids to onSubmit", () => {
    const onSubmit = renderComposer();
    openAndType("New card");

    // Select "Urgent" then "Design" — order of click defines the ids.
    fireEvent.click(screen.getByRole("button", { name: "Urgent" }));
    fireEvent.click(screen.getByRole("button", { name: "Design" }));
    expect(
      screen.getByRole("button", { name: "Urgent" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Design" }),
    ).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: /Add card/i }));
    expect(onSubmit).toHaveBeenCalledWith("New card", ["l2", "l1"]);
  });

  it("can toggle a label back off before submitting", () => {
    const onSubmit = renderComposer();
    openAndType("Another card");
    fireEvent.click(screen.getByRole("button", { name: "Urgent" }));
    fireEvent.click(screen.getByRole("button", { name: "Urgent" })); // off
    fireEvent.click(screen.getByRole("button", { name: /Add card/i }));
    expect(onSubmit).toHaveBeenCalledWith("Another card", []);
  });

  it("submits without label ids when no label was picked", () => {
    const onSubmit = renderComposer();
    openAndType("Plain card");
    fireEvent.click(screen.getByRole("button", { name: /Add card/i }));
    expect(onSubmit).toHaveBeenCalledWith("Plain card", []);
  });

  it("resets the selection after a commit (rapid entry)", () => {
    const onSubmit = renderComposer();
    openAndType("First");
    fireEvent.click(screen.getByRole("button", { name: "Design" }));
    fireEvent.click(screen.getByRole("button", { name: /Add card/i }));
    expect(onSubmit).toHaveBeenCalledWith("First", ["l1"]);

    // Composer stays open; write a second card — no labels carried over.
    const textbox = screen.getByPlaceholderText(/Enter a title/i);
    fireEvent.change(textbox, { target: { value: "Second" } });
    fireEvent.click(screen.getByRole("button", { name: /Add card/i }));
    expect(onSubmit).toHaveBeenLastCalledWith("Second", []);
  });
});