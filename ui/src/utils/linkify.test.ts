import { describe, expect, it } from "vitest";
import { splitLinks } from "./linkify";

describe("splitLinks", () => {
  it("splits a url out of plain text", () => {
    expect(splitLinks("see https://a.b/c now")).toEqual([
      { type: "text", value: "see " },
      { type: "link", value: "https://a.b/c" },
      { type: "text", value: " now" },
    ]);
  });

  it("keeps sentence punctuation out of the link", () => {
    expect(splitLinks("go https://a.b/c.")).toEqual([
      { type: "text", value: "go " },
      { type: "link", value: "https://a.b/c" },
      { type: "text", value: "." },
    ]);
  });

  it("handles several links and linkless text", () => {
    expect(splitLinks("https://a.b and https://c.d")).toEqual([
      { type: "link", value: "https://a.b" },
      { type: "text", value: " and " },
      { type: "link", value: "https://c.d" },
    ]);
    expect(splitLinks("hello")).toEqual([{ type: "text", value: "hello" }]);
  });
});
