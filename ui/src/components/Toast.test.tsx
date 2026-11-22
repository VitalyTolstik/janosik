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
      <button type="button" onClick={() => toast.error("Offline")}>
        push error
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

  it("exposes the region the agent sheet lifts above its footer", () => {
    renderToasts();

    const region = screen.getByRole("region", { name: "Notifications" });
    expect(region.className).toContain("janosik-toast-region");
    expect(region.className).toContain(
      "bottom-[calc(1rem_+_env(safe-area-inset-bottom))]",
    );
    // The surface-aware offset is a bottom lift, not a top move: staying at
    // the top covered the phone sheet's close button.
    expect(region.className).not.toContain("max-md:top-");
    expect(region.className).not.toContain("max-md:bottom-auto");
  });

  it("auto-dismisses after 4.5 seconds", () => {
    renderToasts();
    fireEvent.click(screen.getByRole("button", { name: "push" }));

    act(() => vi.advanceTimersByTime(DISMISS_AFTER_MS - 1));
    expect(screen.getByText("Board saved")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText("Board saved")).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("closes immediately from the labelled close button", () => {
    renderToasts();
    fireEvent.click(screen.getByRole("button", { name: "push" }));

    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss notification" }),
    );
    expect(screen.queryByText("Board saved")).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps one toast per key and re-announces a fresh node", () => {
    renderToasts();
    const push = screen.getByRole("button", { name: "push keyed" });
    fireEvent.click(push);
    const first = screen.getByRole("status");
    expect(first).toHaveTextContent("Label updated");

    fireEvent.click(screen.getByRole("button", { name: "clear keyed" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);

    fireEvent.click(push);
    const second = screen.getByRole("status");
    expect(second).toHaveTextContent("Label updated");
    expect(first.isSameNode(second)).toBe(false);

    fireEvent.click(push);
    const third = screen.getByRole("status");
    expect(third.isSameNode(second)).toBe(false);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    // Only the replacement timer remains; the replaced 4.5 s timer is gone.
    expect(vi.getTimerCount()).toBe(1);
  });

  it("keeps unkeyed successes and errors additive", () => {
    renderToasts();
    fireEvent.click(screen.getByRole("button", { name: "push" }));
    fireEvent.click(screen.getByRole("button", { name: "push" }));
    fireEvent.click(screen.getByRole("button", { name: "push error" }));
    fireEvent.click(screen.getByRole("button", { name: "push error" }));
    expect(screen.getAllByRole("status")).toHaveLength(4);
    expect(screen.getAllByText("Board saved")).toHaveLength(2);
    expect(screen.getAllByText("Offline")).toHaveLength(2);
  });

  it("clear cancels the old timer", () => {
    renderToasts();
    const push = screen.getByRole("button", { name: "push keyed" });
    fireEvent.click(push);
    act(() => vi.advanceTimersByTime(DISMISS_AFTER_MS - 500));
    fireEvent.click(screen.getByRole("button", { name: "clear keyed" }));
    expect(vi.getTimerCount()).toBe(0);
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
    expect(vi.getTimerCount()).toBe(0);
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
    expect(vi.getTimerCount()).toBe(0);
    fireEvent.click(push);
    expect(screen.getByRole("status")).toHaveTextContent("Label updated");
  });
});
