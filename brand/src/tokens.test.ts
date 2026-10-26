import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  colorVarNames,
  fonts,
  glass,
  logo,
  motion,
  overlay,
  shape,
  siteTheme,
  themes,
  typeScale,
} from "./tokens";

/**
 * The TS token object and the CSS custom properties must never drift — this
 * test parses `tokens.css` and compares every value against `tokens.ts`.
 */

/** Parse `--name: value;` declarations, grouped by their selector block. */
function parseBlocks(css: string): Map<string, Record<string, string>> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = new Map<string, Record<string, string>>();
  const re = /([^{}]+)\{([^}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(withoutComments))) {
    const selector = match[1].trim();
    const vars: Record<string, string> = { ...(blocks.get(selector) ?? {}) };
    for (const declaration of match[2].split(";")) {
      const colon = declaration.indexOf(":");
      if (colon === -1) continue;
      const name = declaration.slice(0, colon).trim();
      if (name.startsWith("--")) {
        // Collapse whitespace: multi-line CSS values must equal the
        // single-space TS strings.
        vars[name] = declaration
          .slice(colon + 1)
          .trim()
          .replace(/\s+/g, " ");
      }
    }
    blocks.set(selector, vars);
  }
  return blocks;
}

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
const blocks = parseBlocks(css);
const root = blocks.get(":root") ?? {};
const light = blocks.get(".light") ?? {};

const siteCss = readFileSync(
  new URL("./site-tokens.css", import.meta.url),
  "utf8",
);
const siteRoot = parseBlocks(siteCss).get(":root") ?? {};

describe("brand tokens", () => {
  it("parses both theme blocks", () => {
    expect(Object.keys(root).length).toBeGreaterThan(0);
    expect(Object.keys(light).length).toBeGreaterThan(0);
  });

  it.each(Object.entries(colorVarNames))(
    "colour %s matches %s in both themes",
    (key, varName) => {
      const role = key as keyof typeof themes.dark;
      expect(root[varName]).toBe(themes.dark[role]);
      expect(light[varName]).toBe(themes.light[role]);
    },
  );

  it("shape, glass, overlay, font and motion tokens match", () => {
    expect(root["--radius"]).toBe(shape.radius);
    expect(root["--janosik-glass-transparency"]).toBe(glass.transparency);
    expect(root["--janosik-glass-blur"]).toBe(glass.blur);
    expect(root["--overlay"]).toBe(overlay.scrim);
    expect(root["--overlay-foreground"]).toBe(overlay.foreground);
    expect(root["--overlay-border"]).toBe(overlay.border);
    expect(root["--overlay-button"]).toBe(overlay.button);
    expect(root["--overlay-shadow"]).toBe(overlay.shadow);
    expect(root["--janosik-font-display"]).toBe(fonts.display);
    expect(root["--janosik-ease-out"]).toBe(motion.easeOut);
    expect(root["--janosik-ease-in-out"]).toBe(motion.easeInOut);
    expect(root["--janosik-ease-drawer"]).toBe(motion.easeDrawer);
    expect(root["--janosik-duration-press"]).toBe(motion.durationPress);
    expect(root["--janosik-duration-fast"]).toBe(motion.durationFast);
    expect(root["--janosik-duration-base"]).toBe(motion.durationBase);
    expect(root["--janosik-duration-slow"]).toBe(motion.durationSlow);
    expect(root["--janosik-logo-from"]).toBe(logo.from);
    expect(root["--janosik-logo-to"]).toBe(logo.to);
  });

  it("type scale matches", () => {
    for (const [role, style] of Object.entries(typeScale)) {
      expect(root[`--janosik-type-${role}-size`]).toBe(style.size);
      expect(root[`--janosik-type-${role}-line`]).toBe(style.lineHeight);
      expect(root[`--janosik-type-${role}-weight`]).toBe(style.weight);
      expect(root[`--janosik-type-${role}-tracking`]).toBe(style.tracking);
    }
  });
});

describe("site theme tokens", () => {
  it("parses the site block", () => {
    expect(Object.keys(siteRoot).length).toBeGreaterThan(0);
  });

  it.each(Object.entries(colorVarNames))(
    "site colour %s matches %s",
    (key, varName) => {
      const role = key as keyof typeof siteTheme;
      expect(siteRoot[varName]).toBe(siteTheme[role]);
    },
  );
});
