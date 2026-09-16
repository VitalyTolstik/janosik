import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LimitCounter } from "@/components/ui/limit-counter";
import { showRemaining } from "@/utils/limit-format";
import { I18nProvider } from "@/i18n";

/**
 * Unit tests for the shared "N characters left" counter (TASK-20): it
 * stays hidden until the last ~20% of the limit, turns red when the
 * remainder is critical, and exposes a stable test hook.
 */

describe("LimitCounter", () => {
  it("is hidden far from the limit and appears in the last ~20%", () => {
    expect(showRemaining(100, 300)).toBe(false);
    expect(showRemaining(240, 300)).toBe(false);
    expect(showRemaining(241, 300)).toBe(true);
    expect(showRemaining(0, 50)).toBe(false);
    expect(showRemaining(41, 50)).toBe(true);
  });

  it("renders the remaining count, muted at first", () => {
    render(
      <I18nProvider>
        <LimitCounter length={250} limit={300} testId="counter" />
      </I18nProvider>,
    );
    const counter = screen.getByTestId("counter");
    expect(counter).toHaveTextContent("50 characters left");
    expect(counter.className).not.toContain("text-danger");
  });

  it("turns red when the remainder is critical", () => {
    render(
      <I18nProvider>
        <LimitCounter length={295} limit={300} testId="counter" />
      </I18nProvider>,
    );
    expect(screen.getByTestId("counter").className).toContain("text-danger");
  });

  it("renders nothing while the input is short", () => {
    render(
      <I18nProvider>
        <LimitCounter length={5} limit={100} testId="counter" />
      </I18nProvider>,
    );
    expect(screen.queryByTestId("counter")).toBeNull();
  });

  it("updates live as the user types", () => {
    function Harness() {
      const [text, setText] = useState("y".repeat(85));
      return (
        <I18nProvider>
          <input
            aria-label="demo"
            maxLength={100}
            onChange={(e) => setText(e.target.value)}
            value={text}
          />
          <LimitCounter length={text.length} limit={100} testId="counter" />
        </I18nProvider>
      );
    }
    render(<Harness />);
    expect(screen.getByTestId("counter")).toHaveTextContent(
      "15 characters left",
    );
    fireEvent.change(screen.getByLabelText("demo"), {
      target: { value: "z".repeat(99) },
    });
    expect(screen.getByTestId("counter")).toHaveTextContent("1");
  });
});
