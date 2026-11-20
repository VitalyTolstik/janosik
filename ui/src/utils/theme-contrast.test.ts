import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { LABEL_COLOR_CHIP } from "@janosik/shared";

/**
 * Contrast pairs behind U-04 (TASK-177.15).
 *
 * axe-core cannot compute colours in jsdom (no layout/paint), so the card
 * suite runs axe with `color-contrast` disabled and this file owns the actual
 * AA maths. Every pair below matches a real surface/text token combination:
 * the 15% chip/tab tints are composited over card, surface and background
 * exactly like the browser does, and each ratio must clear WCAG AA (4.5:1)
 * in both themes.
 */

/** Parse `--name: value;` declarations, merged across matching blocks. */
function parseBlocks(css: string, selectors: string[]): Record<string, string> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const vars: Record<string, string> = {};
  const re = /([^{}]+)\{([^}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(withoutComments))) {
    const selector = match[1].trim().replace(/\s+/g, " ");
    if (!selectors.includes(selector)) continue;
    for (const declaration of match[2].split(";")) {
      const colon = declaration.indexOf(":");
      if (colon === -1) continue;
      const name = declaration.slice(0, colon).trim();
      if (name.startsWith("--")) {
        vars[name] = declaration.slice(colon + 1).trim();
      }
    }
  }
  return vars;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const r = Number.parseInt(h.slice(0, 2), 16);
  const g = Number.parseInt(h.slice(2, 4), 16);
  const b = Number.parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const [high, low] = a > b ? [a, b] : [b, a];
  return (high + 0.05) / (low + 0.05);
}

/** sRGB alpha composite of `color` at `alpha` over an opaque `backdrop`. */
function tint(color: string, backdrop: string, alpha: number): string {
  const fg = color.replace("#", "");
  const bg = backdrop.replace("#", "");
  const mix = (index: number) =>
    Math.round(
      alpha * Number.parseInt(fg.slice(index, index + 2), 16) +
        (1 - alpha) * Number.parseInt(bg.slice(index, index + 2), 16),
    );
  return `#${[0, 2, 4]
    .map((index) => mix(index).toString(16).padStart(2, "0"))
    .join("")}`;
}

const uiCss = readFileSync(
  path.join(import.meta.dirname, "..", "index.css"),
  "utf8",
);
const brandCss = readFileSync(
  path.join(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "brand",
    "src",
    "tokens.css",
  ),
  "utf8",
);

const themes = [
  {
    name: "dark",
    css: parseBlocks(brandCss, [":root"]),
    ui: parseBlocks(uiCss, [":root"]),
  },
  {
    name: "light",
    css: parseBlocks(brandCss, [".light"]),
    ui: parseBlocks(uiCss, ["html.light"]),
  },
];

/** Label chip pairs: the base hue paints the 15% fill, the UI token the text. */
const LABEL_PAIRS = [
  ["red", "--danger"],
  ["orange", "--orange"],
  ["yellow", "--yellow"],
  ["brown", "--brown"],
  ["green", "--success"],
  ["teal", "--teal"],
  ["cyan", "--secondary"],
  ["blue", "--blue"],
  ["indigo", "--indigo"],
  ["brand", "--primary"],
  ["fuchsia", "--fuchsia"],
  ["pink", "--pink"],
  ["slate", "--slate"],
  ["warning", "--warning"],
] as const;

describe.each(themes)("$name theme contrast pairs", ({ css, ui }) => {
  const surfaces = ["--card", "--surface", "--background"].map((token) => ({
    token,
    value: css[token],
  }));

  it("muted secondary text clears AA on every surface", () => {
    for (const surface of surfaces) {
      expect(
        contrast(css["--muted-foreground"], surface.value),
        `muted-foreground on ${surface.token}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("empty placeholders and block-type labels clear AA", () => {
    // Column empty state, link empty state, link group headers.
    for (const surface of surfaces) {
      expect(
        contrast(css["--muted-foreground"], surface.value),
        `empty placeholder on ${surface.token}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
    // The MDXEditor block-type trigger paints `--hover` behind its text.
    expect(
      contrast(css["--muted-foreground"], css["--hover"]),
      "block type on --hover",
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("active board/activity tabs clear AA on the 15% primary tint", () => {
    const text = ui["--tab-text"];
    expect(text, "--tab-text is defined").toBeTruthy();
    for (const surface of surfaces) {
      expect(
        contrast(text, tint(css["--primary"], surface.value, 0.15)),
        `primary tab text on ${surface.token}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(LABEL_PAIRS)(
    "%s label chips clear AA on the 15%% tint",
    (name, baseToken) => {
      const text = name === "brand" ? ui["--tab-text"] : ui[`--chip-${name}`];
      expect(text, `${name} chip text token is defined`).toBeTruthy();
      for (const surface of surfaces) {
        expect(
          contrast(text, tint(css[baseToken], surface.value, 0.15)),
          `${name} chip text on ${surface.token}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
});

describe("label chip classes", () => {
  it("use the AA-checked text tokens, not the raw palette hues", () => {
    for (const [name] of LABEL_PAIRS) {
      // The retired picker color lives under `amber` but aliases the warning
      // hue, so both share the `--chip-warning` text token.
      const chipKey = name === "warning" ? "amber" : name;
      const token = name === "brand" ? "--tab-text" : `--chip-${name}`;
      expect(LABEL_COLOR_CHIP[chipKey], `${chipKey} chip class`).toContain(
        `text-(--${token.slice(2)})`,
      );
      expect(
        LABEL_COLOR_CHIP[chipKey],
        `${chipKey} chip keeps its 15% fill`,
      ).toContain("bg-");
    }
    // Retired amber aliases the warning tokens.
    expect(LABEL_COLOR_CHIP.amber).toContain("text-(--chip-warning)");
  });
});
