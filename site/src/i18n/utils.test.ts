import { describe, expect, it } from "vitest";

import { defaultLang, languages, ui } from "./ui";
import {
  getLangFromUrl,
  localizePath,
  stripLocale,
  switchLangUrl,
  useTranslations,
} from "./utils";

describe("ui dictionaries", () => {
  it("has the same key set in every language", () => {
    const english = Object.keys(ui.en).sort();
    for (const lang of Object.keys(languages) as (keyof typeof ui)[]) {
      expect(Object.keys(ui[lang]).sort(), `keys of "${lang}"`).toEqual(
        english,
      );
    }
  });

  it("has no empty values (except price periods)", () => {
    for (const [lang, dict] of Object.entries(ui)) {
      for (const [key, value] of Object.entries(dict)) {
        if (key.endsWith(".period")) continue;
        expect(value, `${lang}.${key}`).not.toBe("");
      }
    }
  });
});

describe("localizePath", () => {
  it("keeps the default language unprefixed with a trailing slash", () => {
    expect(localizePath("/pricing", "en")).toBe("/pricing/");
  });

  it("prefixes other languages", () => {
    expect(localizePath("/pricing", "ru")).toBe("/ru/pricing/");
  });

  it("handles the root", () => {
    expect(localizePath("/", "en")).toBe("/");
    expect(localizePath("/", "ru")).toBe("/ru/");
  });

  it("preserves anchors", () => {
    expect(localizePath("/#features", "en")).toBe("/#features");
    expect(localizePath("/#features", "ru")).toBe("/ru/#features");
  });
});

describe("stripLocale", () => {
  it("removes a locale prefix", () => {
    expect(stripLocale("/ru/pricing/")).toBe("/pricing/");
  });

  it("leaves unprefixed paths alone", () => {
    expect(stripLocale("/pricing/")).toBe("/pricing/");
  });

  it("normalises the root", () => {
    expect(stripLocale("/ru/")).toBe("/");
    expect(stripLocale("/")).toBe("/");
  });
});

describe("getLangFromUrl", () => {
  it("detects a locale prefix", () => {
    expect(getLangFromUrl(new URL("https://example.com/ru/pricing/"))).toBe(
      "ru",
    );
  });

  it("falls back to the default", () => {
    expect(getLangFromUrl(new URL("https://example.com/pricing/"))).toBe(
      defaultLang,
    );
  });
});

describe("switchLangUrl", () => {
  it("maps a page to the other language", () => {
    expect(switchLangUrl("/pricing/", "ru")).toBe("/ru/pricing/");
    expect(switchLangUrl("/ru/pricing/", "en")).toBe("/pricing/");
  });
});

describe("useTranslations", () => {
  it("returns the string for the language", () => {
    expect(useTranslations("ru")("nav.pricing")).toBe("Тарифы");
    expect(useTranslations("en")("nav.pricing")).toBe("Pricing");
  });
});
