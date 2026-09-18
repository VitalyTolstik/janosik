import { describe, expect, it } from "vitest";
import { autolinkMarkdown, splitLinks } from "./linkify";

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

describe("autolinkMarkdown", () => {
  it("wraps bare urls into markdown links", () => {
    expect(autolinkMarkdown("see https://a.b/c now")).toBe(
      "see [https://a.b/c](https://a.b/c) now",
    );
  });

  it("keeps sentence punctuation outside the link", () => {
    expect(autolinkMarkdown("go https://a.b/c.")).toBe(
      "go [https://a.b/c](https://a.b/c).",
    );
  });

  it("leaves existing markdown links alone", () => {
    expect(autolinkMarkdown("[label](https://a.b) and https://c.d")).toBe(
      "[label](https://a.b) and [https://c.d](https://c.d)",
    );
  });

  it("returns markdown without urls untouched", () => {
    expect(autolinkMarkdown("plain **bold** text")).toBe("plain **bold** text");
  });
});
