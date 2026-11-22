import {
  DEFAULT_REVISION_LIMIT,
  MAX_REVISION_LIMIT,
  encodeCommentRevisionCursor,
  parseCommentRevisionPage,
} from "./comment-revisions.service";

/**
 * TASK-185.3 cursor/limit rules. The HTTP e2e proves the routes; these cover
 * the boundary and opacity rules without a database round trip.
 */
describe("comment revision pagination", () => {
  it("defaults to 20 and accepts 1…100", () => {
    expect(DEFAULT_REVISION_LIMIT).toBe(20);
    expect(MAX_REVISION_LIMIT).toBe(100);
    expect(parseCommentRevisionPage("c1").limit).toBe(20);
    expect(parseCommentRevisionPage("c1", undefined, "").limit).toBe(20);
    expect(parseCommentRevisionPage("c1", undefined, "1").limit).toBe(1);
    expect(parseCommentRevisionPage("c1", undefined, "100").limit).toBe(100);
  });

  it.each(["0", "101", "-1", "1.5", "ten", "1e2", "+20", " 20", "0x14"])(
    "rejects limit %s",
    (limit) => {
      expect(() => parseCommentRevisionPage("c1", undefined, limit)).toThrow(
        "limit must be an integer 1…100",
      );
    },
  );

  it("round-trips the comment id and last revision number", () => {
    const cursor = encodeCommentRevisionCursor("comment-1", 42);
    expect(parseCommentRevisionPage("comment-1", cursor).cursor).toEqual({
      commentId: "comment-1",
      revisionNumber: 42,
    });
  });

  it("rejects a malformed cursor", () => {
    for (const raw of ["not-a-cursor", "%", "e30"]) {
      expect(() => parseCommentRevisionPage("comment-1", raw)).toThrow(
        "cursor is malformed",
      );
    }
    // Valid JSON but the wrong shape / non-positive revision number.
    for (const raw of [
      Buffer.from("null").toString("base64url"),
      Buffer.from('{"c":"comment-1"}').toString("base64url"),
      Buffer.from('{"c":"comment-1","r":0}').toString("base64url"),
      Buffer.from('{"c":"comment-1","r":1.5}').toString("base64url"),
    ]) {
      expect(() => parseCommentRevisionPage("comment-1", raw)).toThrow(
        "cursor is malformed",
      );
    }
  });

  it("rejects a cursor issued for another comment", () => {
    const foreign = encodeCommentRevisionCursor("comment-2", 3);
    expect(() => parseCommentRevisionPage("comment-1", foreign)).toThrow(
      "another comment",
    );
  });
});
