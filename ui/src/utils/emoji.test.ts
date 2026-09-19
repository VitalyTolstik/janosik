import { describe, expect, it } from "vitest";

import { emojify } from "@/utils/emoji";

describe("emojify", () => {
  it("converts known shortcodes", () => {
    expect(emojify("ship it :rocket:")).toBe("ship it 🚀");
    expect(emojify(":+1: :-1: :fire: :tada:")).toBe("👍 👎 🔥 🎉");
  });

  it("is case-insensitive on shortcodes", () => {
    expect(emojify(":FIRE:")).toBe("🔥");
  });

  it("leaves unknown shortcodes untouched", () => {
    expect(emojify(":not_an_emoji:")).toBe(":not_an_emoji:");
  });

  it("converts ASCII emoticons at a boundary", () => {
    expect(emojify("nice :)")).toBe("nice 🙂");
    expect(emojify("sad :( fine ;D".replace(";D", ";)"))).toBe(
      "sad 🙁 fine 😉",
    );
    expect(emojify("I <3 this")).toBe("I ❤️ this");
    expect(emojify(":-D hi")).toBe("😄 hi");
  });

  it("does not fire inside words or URLs", () => {
    // `:/` needs a boundary — inside `https://` it must survive.
    expect(emojify("see https://example.com/docs")).toBe(
      "see https://example.com/docs",
    );
    expect(emojify("word:)")).toBe("word:)");
  });

  it("never touches code", () => {
    expect(emojify("use `:fire:` inline")).toBe("use `:fire:` inline");
    expect(emojify("```\n:rocket: :)\n```")).toBe("```\n:rocket: :)\n```");
  });

  it("keeps markdown structure intact", () => {
    expect(emojify("- **bold** :fire:\n- plain")).toBe(
      "- **bold** 🔥\n- plain",
    );
  });

  it("is a no-op on emoji-free text", () => {
    expect(emojify("plain text")).toBe("plain text");
    expect(emojify("")).toBe("");
  });
});
