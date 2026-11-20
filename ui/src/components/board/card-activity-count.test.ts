import { describe, expect, it } from "vitest";

import { mergeNewestActivity } from "./card-activity-count";

describe("mergeNewestActivity", () => {
  it.each(["known", "unknown"])(
    "keeps the known total when the refresh omits it and the boundary is %s",
    (boundary) => {
      const current = {
        items: [{ id: "known" }],
        nextCursor: "current-cursor",
        total: 65,
      };
      const newest = {
        items: [{ id: boundary }],
        nextCursor: "newest-cursor",
      };

      expect(mergeNewestActivity(current, newest).total).toBe(65);
      expect(mergeNewestActivity(current, { ...newest, total: 66 }).total).toBe(
        66,
      );
    },
  );
});
