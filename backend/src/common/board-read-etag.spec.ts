import {
  boardReadEtag,
  ifNoneMatchMatches,
  type BoardReadValidatorInput,
} from "./board-read-etag";

const INPUT: BoardReadValidatorInput = {
  boardId: "board-1",
  revision: 7n,
  route: "GET /boards/:id",
  role: "MEMBER",
  projection: "board-full:v1",
};

describe("boardReadEtag", () => {
  it("is stable for identical material and weak", () => {
    const first = boardReadEtag(INPUT);
    expect(boardReadEtag({ ...INPUT })).toBe(first);
    expect(first).toMatch(/^W\/"[A-Za-z0-9_-]{32}"$/);
  });

  it("changes for every projection input", () => {
    const base = boardReadEtag(INPUT);
    expect(boardReadEtag({ ...INPUT, boardId: "board-2" })).not.toBe(base);
    expect(boardReadEtag({ ...INPUT, revision: 8n })).not.toBe(base);
    expect(
      boardReadEtag({ ...INPUT, route: "GET /boards/:id/summary" }),
    ).not.toBe(base);
    expect(boardReadEtag({ ...INPUT, role: "ADMIN" })).not.toBe(base);
    expect(boardReadEtag({ ...INPUT, projection: "board-full:v2" })).not.toBe(
      base,
    );
  });

  it("does not expose ids, roles or credentials", () => {
    const etag = boardReadEtag(INPUT);
    expect(etag).not.toContain("board-1");
    expect(etag).not.toContain("MEMBER");
    expect(etag).not.toContain("token");
    expect(etag).not.toContain("user");
  });
});

describe("ifNoneMatchMatches", () => {
  const etag = boardReadEtag(INPUT);

  it("matches the same weak tag and its strong form", () => {
    expect(ifNoneMatchMatches(etag, etag)).toBe(true);
    expect(ifNoneMatchMatches(etag.slice(2), etag)).toBe(true);
    expect(ifNoneMatchMatches(`W/${etag.slice(2)}`, etag)).toBe(true);
  });

  it("matches a member of a list and the wildcard", () => {
    expect(ifNoneMatchMatches(`W/"other", ${etag}`, etag)).toBe(true);
    expect(ifNoneMatchMatches("*", etag)).toBe(true);
  });

  it("does not match a different tag or a malformed header", () => {
    expect(ifNoneMatchMatches(`W/"other"`, etag)).toBe(false);
    expect(ifNoneMatchMatches("board-1", etag)).toBe(false);
    expect(ifNoneMatchMatches(undefined, etag)).toBe(false);
    expect(ifNoneMatchMatches("", etag)).toBe(false);
  });
});
