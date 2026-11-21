import {
  HISTORY_REASON_PRIORITY,
  mergeHistoryIncompleteReason,
  nextHistoryTimestamp,
} from "./comment-history";

/**
 * TASK-185.1 pure writer rules. These are the pieces that are easy to get
 * subtly wrong and expensive to prove through HTTP alone.
 */
describe("comment history writer helpers", () => {
  it("merges incomplete reasons by the §3.1 priority", () => {
    expect(HISTORY_REASON_PRIORITY.writer_gap).toBeGreaterThan(
      HISTORY_REASON_PRIORITY.gdpr_erase,
    );
    expect(HISTORY_REASON_PRIORITY.gdpr_erase).toBeGreaterThan(
      HISTORY_REASON_PRIORITY.revision_limit,
    );
    expect(HISTORY_REASON_PRIORITY.revision_limit).toBeGreaterThan(
      HISTORY_REASON_PRIORITY.legacy_cutover,
    );

    expect(mergeHistoryIncompleteReason(null, "legacy_cutover")).toBe(
      "legacy_cutover",
    );
    expect(
      mergeHistoryIncompleteReason("legacy_cutover", "revision_limit"),
    ).toBe("revision_limit");
    expect(
      mergeHistoryIncompleteReason("revision_limit", "legacy_cutover"),
    ).toBe("revision_limit");
    expect(mergeHistoryIncompleteReason("gdpr_erase", "writer_gap")).toBe(
      "writer_gap",
    );
    expect(mergeHistoryIncompleteReason("writer_gap", "gdpr_erase")).toBe(
      "writer_gap",
    );
  });

  it("keeps the revision timestamp after cutover and the previous edit", () => {
    const cutover = new Date(1_000);
    const previous = new Date(5_000);
    expect(nextHistoryTimestamp(1, cutover, null).getTime()).toBe(1_001);
    expect(nextHistoryTimestamp(3_000, cutover, null).getTime()).toBe(3_000);
    expect(nextHistoryTimestamp(3_000, cutover, previous).getTime()).toBe(
      5_001,
    );
    expect(nextHistoryTimestamp(9_000, cutover, previous).getTime()).toBe(
      9_000,
    );
  });
});
