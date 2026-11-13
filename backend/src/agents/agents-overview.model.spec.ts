import {
  effectiveApprovalStatus,
  encodeOverviewCursor,
  decodeOverviewCursor,
  escapeLikePattern,
  overviewBinding,
} from "./agents-overview.model";

const NOW = new Date("2026-11-13T12:00:00.000Z");

describe("agents overview model", () => {
  it("computes effective expiry at one time slice without writing", () => {
    expect(effectiveApprovalStatus("pending", NOW.getTime() + 1, NOW)).toBe(
      "pending",
    );
    expect(effectiveApprovalStatus("pending", NOW.getTime(), NOW)).toBe(
      "expired",
    );
    expect(effectiveApprovalStatus("approved", NOW.getTime() - 1, NOW)).toBe(
      "expired",
    );
    expect(effectiveApprovalStatus("rejected", 0, NOW)).toBe("rejected");
    expect(effectiveApprovalStatus("consumed", 0, NOW)).toBe("consumed");
  });

  it("escapes LIKE metacharacters so q is a literal substring", () => {
    expect(escapeLikePattern("100%_done\\")).toBe("100\\%\\_done\\\\");
  });

  it("round-trips a cursor bound to section, filters and scope", () => {
    const binding = overviewBinding({
      section: "sessions",
      boardId: null,
      q: "алфа",
      status: "live",
      kind: undefined,
      tokenId: undefined,
      sessionId: undefined,
      from: 1,
      to: 2,
      scope: ["b1:ADMIN", "b2:MEMBER"],
    });
    const encoded = encodeOverviewCursor({
      v: 1,
      b: binding,
      g: "session",
      t: 123,
      i: "s1",
    });
    expect(decodeOverviewCursor(encoded, binding)).toMatchObject({
      g: "session",
      t: 123,
      i: "s1",
    });
    expect(() =>
      decodeOverviewCursor(
        encoded,
        overviewBinding({
          section: "sessions",
          boardId: null,
          q: "алфа",
          status: "stale",
          kind: undefined,
          tokenId: undefined,
          sessionId: undefined,
          from: 1,
          to: 2,
          scope: ["b1:ADMIN", "b2:MEMBER"],
        }),
      ),
    ).toThrow(/Invalid or stale cursor/);
  });

  it("allows only the decided group to point at its start", () => {
    const binding = "binding";
    const start = encodeOverviewCursor({
      v: 1,
      b: binding,
      g: "approval_decided",
      t: null,
      i: null,
    });
    expect(decodeOverviewCursor(start, binding)).toMatchObject({
      g: "approval_decided",
      t: null,
      i: null,
    });
    const pendingStart = encodeOverviewCursor({
      v: 1,
      b: binding,
      g: "approval_pending",
      t: null,
      i: null,
    });
    expect(() => decodeOverviewCursor(pendingStart, binding)).toThrow(
      /Invalid or stale cursor/,
    );
  });
});
