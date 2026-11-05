import { describe, expect, it } from "vitest";

const sources = import.meta.glob(
  ["../**/*.{ts,tsx}", "!../**/*.test.{ts,tsx}"],
  {
    eager: true,
    query: "?raw",
    import: "default",
  },
) as Record<string, string>;

describe("form validation policy", () => {
  it("disables browser validation popups on every application form", () => {
    const offenders = Object.entries(sources)
      .filter(([, source]) => /<form\b(?!\s+noValidate\b(?!\s*=))/.test(source))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("does not explicitly open browser validation popups", () => {
    const offenders = Object.entries(sources)
      .filter(([, source]) => /\.reportValidity\s*\(/.test(source))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
