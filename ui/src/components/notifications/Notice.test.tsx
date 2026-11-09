import { fireEvent, render, screen } from "@testing-library/react";
import { Megaphone } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { Notice } from "@/components/notifications/Notice";

describe("Notice", () => {
  it("renders eyebrow, title and body with the info tone", () => {
    render(
      <Notice
        tone="info"
        icon={Megaphone}
        eyebrow="What's new"
        title="Search across checklists"
        body="Ctrl+K now finds checklist items."
        testId="notice"
      />,
    );

    const notice = screen.getByTestId("notice");
    expect(notice).toHaveAttribute("data-tone", "info");
    expect(notice).toHaveTextContent("What's new");
    expect(notice).toHaveTextContent("Search across checklists");
    expect(notice).toHaveTextContent("Ctrl+K now finds checklist items.");
  });

  it("treats warnings and errors as assertive alerts by default", () => {
    const { rerender } = render(<Notice tone="warning" title="Offline" />);
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");

    rerender(<Notice tone="danger" title="Save failed" />);
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
  });

  it("keeps info and brand messages polite statuses", () => {
    const { rerender } = render(<Notice tone="info" title="Hello" />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");

    rerender(<Notice tone="brand" title="Update" />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("lets the caller override role and live region", () => {
    render(
      <Notice tone="danger" role="status" live="polite" title="Heads up" />,
    );
    const notice = screen.getByRole("status");
    expect(notice).toHaveAttribute("aria-live", "polite");
  });

  it("runs actions and closes through the labelled close button", () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    render(
      <Notice
        tone="danger"
        title="Connection lost"
        actions={
          <button type="button" onClick={onAction}>
            Retry
          </button>
        }
        close={{
          onClick: onClose,
          label: "Dismiss notice",
          testId: "notice-close",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onAction).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("notice-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not render a close button when close is omitted", () => {
    render(<Notice tone="warning" title="View as user" />);
    expect(
      screen.queryByRole("button", { name: /dismiss/i }),
    ).not.toBeInTheDocument();
  });
});
