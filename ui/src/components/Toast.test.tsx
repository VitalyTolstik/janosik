import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider, useToast } from "@/components/Toast";
import { I18nProvider } from "@/i18n";

const DISMISS_AFTER_MS = 4500;

function Trigger() {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast.success("Board saved")}>
      push
    </button>
  );
}

function renderToasts() {
  return render(
    <I18nProvider>
      <ToastProvider>
        <Trigger />
      </ToastProvider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Toast", () => {
  it("shows the message in a status card inside the notifications region", () => {
    renderToasts();
    fireEvent.click(screen.getByRole("button", { name: "push" }));

    expect(
      screen.getByRole("region", { name: "Notifications" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Board saved");
  });

  it("auto-dismisses after 4.5 seconds", () => {
    renderToasts();
    fireEvent.click(screen.getByRole("button", { name: "push" }));

    act(() => vi.advanceTimersByTime(DISMISS_AFTER_MS - 1));
    expect(screen.getByText("Board saved")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText("Board saved")).not.toBeInTheDocument();
  });

  it("closes immediately from the labelled close button", () => {
    renderToasts();
    fireEvent.click(screen.getByRole("button", { name: "push" }));

    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss notification" }),
    );
    expect(screen.queryByText("Board saved")).not.toBeInTheDocument();
  });
});
