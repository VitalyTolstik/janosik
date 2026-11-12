import { describe, expect, it } from "vitest";

import { effectiveApprovalStatus } from "@/utils/approval";

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
