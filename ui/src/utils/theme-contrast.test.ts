import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  LABEL_COLORS,
  LABEL_COLOR_CHIP,
  USER_AVATAR_COLORS,
} from "@janosik/shared";

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
    ui: {
      ...parseBlocks(uiCss, [":root"]),
      ...parseBlocks(uiCss, ["html.light"]),
    },
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

describe.each(themes)("$name theme contrast pairs", ({ name, css, ui }) => {
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
      for (const alpha of [0.1, 0.15]) {
        expect(
          contrast(text, tint(css["--primary"], surface.value, alpha)),
          `primary tab text on ${surface.token} at ${alpha}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("avatar initials clear AA on every palette hue", () => {
    const ink = ui["--avatar-ink"];
    const inverse = ui["--avatar-ink-inverse"];
    expect(ink, "--avatar-ink is defined").toBeTruthy();
    expect(inverse, "--avatar-ink-inverse is defined").toBeTruthy();
    // Mirrors the light-theme CSS inversion list for the deeper hues.
    const lightInverse = new Set([
      "primary",
      "secondary",
      "blue",
      "indigo",
      "danger",
      "fuchsia",
      "pink",
      "slate",
    ]);
    for (const color of USER_AVATAR_COLORS) {
      const text = name === "light" && lightInverse.has(color) ? inverse : ink;
      expect(
        contrast(text, css[`--${color}`]),
        `avatar ink on ${color}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("mention links clear AA on primary tints, including the focused row", () => {
    const text = ui["--agent-tone-primary"];
    expect(text, "--agent-tone-primary is defined").toBeTruthy();
    for (const surface of surfaces) {
      for (const alpha of [0.12, 0.22]) {
        expect(
          contrast(text, tint(css["--primary"], surface.value, alpha)),
          `mention link on ${surface.token} at ${alpha}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("filled action buttons clear AA with white text", () => {
    // Filled primary/destructive actions use dedicated fill tokens: the raw
    // `--primary`/`--danger` accents only reach 3.68:1/3.76:1 with white
    // labels in dark. Saved views is the first consumer (TASK-177.20).
    for (const [fill, name] of [
      ["--action-primary", "primary"],
      ["--action-danger", "danger"],
    ] as const) {
      const value = ui[fill];
      expect(value, `${fill} is defined`).toBeTruthy();
      expect(
        contrast(css["--primary-foreground"], value),
        `white on ${name} action fill`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("bulk selection counts clear AA on the secondary button tint", () => {
    for (const surface of surfaces) {
      for (const buttonAlpha of [1, 0.9]) {
        const buttonFill = tint(css["--secondary"], surface.value, buttonAlpha);
        const countFill = tint(css["--primary"], buttonFill, 0.15);
        expect(
          contrast(css["--secondary-foreground"], countFill),
          `bulk selection count over ${surface.token} at ${buttonAlpha}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("bulk delete hover clears AA with white text", () => {
    const hoverFill = tint(ui["--action-danger"], "#000000", 0.85);
    expect(contrast("#ffffff", hoverFill)).toBeGreaterThanOrEqual(4.5);
  });

  it("admin warning text clears AA on plain, highlighted and tinted fills", () => {
    for (const surface of [
      ...surfaces,
      { token: "--hover", value: css["--hover"] },
    ]) {
      for (const alpha of [0, 0.1]) {
        expect(
          contrast(
            ui["--chip-warning"],
            tint(css["--warning"], surface.value, alpha),
          ),
          `admin warning on ${surface.token} at ${alpha}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("status chips clear AA on their 10% and 15% fills", () => {
    const pairs = [
      ["--danger", "--chip-red"],
      ["--warning", "--chip-warning"],
      ["--success", "--chip-green"],
    ] as const;
    for (const [base, textToken] of pairs) {
      const text = ui[textToken];
      expect(text, `${textToken} is defined`).toBeTruthy();
      for (const surface of surfaces) {
        for (const alpha of [0.1, 0.15]) {
          expect(
            contrast(text, tint(css[base], surface.value, alpha)),
            `${textToken} on ${base} at ${alpha} over ${surface.token}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
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

  it("guards every label color the picker can offer", () => {
    const paired = new Set<string>(LABEL_PAIRS.map(([name]) => name));
    for (const color of LABEL_COLORS) {
      expect(LABEL_COLOR_CHIP[color], `${color} chip class`).toBeTruthy();
      if (color === "plain") continue;
      // `amber` is not in LABEL_COLORS today; it is covered above as the
      // retired warning alias. A new picker color without a contrast pair
      // fails here instead of silently shipping a raw hue.
      expect(paired.has(color), `${color} has a contrast pair`).toBe(true);
    }
  });
});

/**
 * Source guards for class overrides. Tailwind emits utilities in generation
 * order, not class-attribute order, so a leftover `text-primary` beside
 * `bg-primary/15` can silently win over `text-(--tab-text)` regardless of
 * where it sits in `cn(...)`. These scans fail if a raw palette hue returns
 * to a tinted surface or an active toggle stops using the tab token.
 */
describe("tinted-state classes in components", () => {
  const UI_SRC = path.join(import.meta.dirname, "..");
  const read = (relative: string) =>
    readFileSync(path.join(UI_SRC, relative), "utf8");

  const FILES = [
    "components/board/FilterBar.tsx",
    "components/board/CalendarView.tsx",
    "components/board/ViewSwitcher.tsx",
    "components/board/CardActivity.tsx",
    "components/board/CardLinks.tsx",
    "components/board/TableView.tsx",
    "components/board/CardItem.tsx",
    "components/board/CardHistory.tsx",
    "components/board/DueBadge.tsx",
    "components/board/ColumnView.tsx",
    "components/board/WatchView.tsx",
    "components/board/workflow/TransitionList.tsx",
    "components/board/UserProfileDialog.tsx",
  ] as const;

  const TINTED_TEXT_RULES = [
    ["bg-primary/1[05]", "text-primary(?![\\w-])"],
    ["bg-warning/1[05]", "text-warning(?![\\w-])"],
    ["bg-danger/1[05]", "text-danger(?![\\w-])"],
    ["bg-success/1[05]", "text-success(?![\\w-])"],
  ] as const;

  it.each(FILES)("%s pairs tinted fills with tint-safe text", (file) => {
    const source = read(file);
    // Only compare within one class literal: two sibling `cn(...)` branches
    // may legitimately name the fill and the text on separate lines.
    const literals = [...source.matchAll(/"([^"\n]*)"/g)].map(
      (match) => match[1],
    );
    for (const [fill, text] of TINTED_TEXT_RULES) {
      const fillPattern = new RegExp(`^.*${fill}`);
      const textPattern = new RegExp(`^.*${text}`);
      for (const literal of literals) {
        expect(
          fillPattern.test(literal) && textPattern.test(literal),
          `${file}: "${literal}" must not pair ${fill} with ${text}`,
        ).toBe(false);
      }
    }
  });

  it("keeps every active primary toggle on the tab token", () => {
    for (const file of [
      "components/board/FilterBar.tsx",
      "components/board/CalendarView.tsx",
      "components/board/ViewSwitcher.tsx",
      "components/board/CardActivity.tsx",
    ]) {
      expect(read(file), `${file}: active toggle token`).toContain(
        "text-(--tab-text)",
      );
    }
  });
});
