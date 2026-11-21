import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider, useToast } from "@/components/Toast";
import { I18nProvider } from "@/i18n";

const DISMISS_AFTER_MS = 4500;

function Trigger() {
  const toast = useToast();
  return (
    <>
      <button type="button" onClick={() => toast.success("Board saved")}>
        push
      </button>
      <button
        type="button"
        onClick={() => toast.success("Label updated", { key: "labels:card-1" })}
      >
        push keyed
      </button>
      <button type="button" onClick={() => toast.clear("labels:card-1")}>
        clear keyed
      </button>
    </>
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

  it("keeps one toast per key and re-announces a fresh node", () => {
    renderToasts();
    const push = screen.getByRole("button", { name: "push keyed" });
    fireEvent.click(push);
    const first = screen.getByRole("status");
    expect(first).toHaveTextContent("Label updated");

    fireEvent.click(screen.getByRole("button", { name: "clear keyed" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.click(push);
    const second = screen.getByRole("status");
    expect(second).toHaveTextContent("Label updated");
    expect(first.isSameNode(second)).toBe(false);

    fireEvent.click(push);
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("clear cancels the old timer", () => {
    renderToasts();
    const push = screen.getByRole("button", { name: "push keyed" });
    fireEvent.click(push);
    act(() => vi.advanceTimersByTime(DISMISS_AFTER_MS - 500));
    fireEvent.click(screen.getByRole("button", { name: "clear keyed" }));
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.click(push);
    act(() => vi.advanceTimersByTime(DISMISS_AFTER_MS - 1));
    expect(screen.getByRole("status")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("manual close cancels the keyed timer and a new push survives", () => {
    renderToasts();
    const push = screen.getByRole("button", { name: "push keyed" });
    fireEvent.click(push);
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss notification" }),
    );
    fireEvent.click(push);
    act(() => vi.advanceTimersByTime(DISMISS_AFTER_MS - 1));
    expect(screen.getByRole("status")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("auto-dismisses a keyed toast and allows a fresh push", () => {
    renderToasts();
    const push = screen.getByRole("button", { name: "push keyed" });
    fireEvent.click(push);
    act(() => vi.advanceTimersByTime(DISMISS_AFTER_MS));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.click(push);
    expect(screen.getByRole("status")).toHaveTextContent("Label updated");
  });
});
