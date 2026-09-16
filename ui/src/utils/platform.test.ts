import { describe, expect, it } from "vitest";

import { isMacPlatform } from "@/utils/platform";

/**
 * TASK-21.8: the Mac check reads the UA client hint
 * `userAgentData.platform` first and falls back to the deprecated
 * `navigator.platform`. The fake navigators below exercise both paths.
 */
function fakeNav(parts: {
  platform: string;
  userAgentData?: { platform?: string };
}): Navigator {
  return parts as unknown as Navigator;
}

describe("isMacPlatform", () => {
  it("reads the UA client hint when available", () => {
    const nav = fakeNav({
      platform: "Win32",
      userAgentData: { platform: "macOS" },
    });
    expect(isMacPlatform(nav)).toBe(true);
  });

  it("falls back to the legacy navigator.platform", () => {
    expect(
      isMacPlatform(fakeNav({ platform: "MacIntel", userAgentData: {} })),
    ).toBe(true);
    expect(isMacPlatform(fakeNav({ platform: "iPhone" }))).toBe(true);
  });

  it("is false for Windows, Linux and empty strings", () => {
    expect(
      isMacPlatform(
        fakeNav({
          platform: "Win32",
          userAgentData: { platform: "Windows" },
        }),
      ),
    ).toBe(false);
    expect(isMacPlatform(fakeNav({ platform: "Linux x86_64" }))).toBe(false);
    expect(isMacPlatform(fakeNav({ platform: "" }))).toBe(false);
  });
});
