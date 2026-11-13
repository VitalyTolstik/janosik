import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";

import { AgentStatusBadge } from "@/components/agents/agents-ui";
import { RunStatusBadge } from "@/components/agents/run-ui";
import { SessionStatusPill } from "@/components/agents/session-ui";
import { StatusBadge } from "@/components/agents/status-badge";
import { ApprovalStatusBadge } from "@/components/approvals/approval-ui";
import { I18nProvider } from "@/i18n";

function withI18n(node: ReactNode) {
  return render(<I18nProvider>{node}</I18nProvider>);
}

describe("one status badge primitive (TASK-179.9)", () => {
  it("renders the shared dot + label shell", () => {
    withI18n(
      <StatusBadge label="Applied" tone="ok" status="applied" testId="badge" />,
    );
    const badge = screen.getByTestId("badge");
    expect(badge).toHaveAttribute("data-status", "applied");
    expect(badge.className).toContain("h-[22px]");
    expect(badge.className).toContain("items-center");
    expect(badge.className).toContain("text-[11px]");
    expect(badge.className).toContain("gap-1.5");
    expect(badge.querySelector("[aria-hidden]")?.className).toContain(
      "rounded-full",
    );
  });

  it.each([
    ["pending", "Pending"],
    ["approved", "Approved"],
    ["rejected", "Rejected"],
    ["expired", "Expired"],
    ["cancelled", "Cancelled"],
    ["consumed", "Consumed"],
  ] as const)("renders the approval status %s", (status, label) => {
    withI18n(<ApprovalStatusBadge status={status} testId="approval" />);
    const badge = screen.getByTestId("approval");
    expect(badge).toHaveAttribute("data-status", status);
    expect(badge).toHaveTextContent(label);
    expect(badge.className).toContain("h-[22px]");
  });

  it.each(["applied", "reverted", "failed"] as const)(
    "renders the run status %s",
    (status) => {
      withI18n(<RunStatusBadge status={status} testId="run" />);
      const badge = screen.getByTestId("run");
      expect(badge).toHaveAttribute("data-status", status);
      expect(badge.className).toContain("h-[22px]");
    },
  );

  it.each([
    "active",
    "idle",
    "waiting_approval",
    "completed",
    "failed",
    "cancelled",
  ] as const)("renders the session lifecycle %s", (status) => {
    withI18n(<SessionStatusPill status={status} />);
    const badge = screen.getByTestId(`agent-status-${status}`);
    expect(badge).toHaveAttribute("data-lifecycle", "true");
    expect(badge).toHaveAttribute("data-status", status);
    expect(badge.className).toContain("h-[22px]");
  });

  it("keeps the agent badge on the same primitive", () => {
    withI18n(<AgentStatusBadge status="active" />);
    const badge = screen.getByTestId("agent-status-active");
    expect(badge.className).toContain("h-[22px]");
    expect(badge).toHaveTextContent("Active");
  });
});
