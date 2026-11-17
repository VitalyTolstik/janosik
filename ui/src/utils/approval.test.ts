import { describe, expect, it } from "vitest";

import {
  effectiveApprovalStatus,
  formatApprovalMoment,
} from "@/utils/approval";

describe("effectiveApprovalStatus", () => {
  const now = 1_000_000;

  it("keeps a pending approval with a future TTL", () => {
    expect(effectiveApprovalStatus("pending", now + 1, now)).toBe("pending");
  });

  it("reports an overdue pending approval as expired without a write", () => {
    expect(effectiveApprovalStatus("pending", now, now)).toBe("expired");
    expect(effectiveApprovalStatus("pending", now - 1, now)).toBe("expired");
  });

  it("does not rewrite terminal statuses", () => {
    expect(effectiveApprovalStatus("approved", now - 1, now)).toBe("approved");
    expect(effectiveApprovalStatus("consumed", now - 1, now)).toBe("consumed");
    expect(effectiveApprovalStatus("cancelled", now - 1, now)).toBe(
      "cancelled",
    );
  });
});

describe("formatApprovalMoment", () => {
  const translate = ((
    key: string,
    options?: Record<string, string | number>,
  ) => {
    if (key === "agents.approvals.todayAt")
      return `Today, ${options?.time ?? ""}`;
    if (key === "agents.approvals.yesterdayAt")
      return `Yesterday, ${options?.time ?? ""}`;
    return key;
  }) as unknown as Parameters<typeof formatApprovalMoment>[2];

  it("uses an absolute time for today and yesterday decisions", () => {
    const now = new Date(2026, 10, 17, 18, 0).getTime();
    expect(
      formatApprovalMoment(
        new Date(2026, 10, 17, 17, 15).getTime(),
        "en",
        translate,
        now,
      ),
    ).toBe("Today, 5:15 PM");
    expect(
      formatApprovalMoment(
        new Date(2026, 10, 16, 9, 5).getTime(),
        "en",
        translate,
        now,
      ),
    ).toBe("Yesterday, 9:05 AM");
  });

  it("falls back to the compact locale date for older decisions", () => {
    const now = new Date(2026, 10, 17, 18, 0).getTime();
    const label = formatApprovalMoment(
      new Date(2026, 10, 10, 17, 15).getTime(),
      "en",
      translate,
      now,
    );
    expect(label).toContain("11/10/26");
  });
});
