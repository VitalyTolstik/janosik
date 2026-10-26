import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const brandOg = resolve(here, "../../../brand/assets/og/janosik-og.svg");
const publicDir = resolve(here, "../../public");

// Per-page social cards, generated from the brand's OG template so the design
// stays in `brand/` and only the subtitle changes. Home uses the default
// `/og.png` (copied by `brand-assets`); these add the pages that benefit from
// their own card.
const pages = [
  { slug: "og-pricing", subtitle: "Simple, honest pricing" },
  { slug: "og-docs", subtitle: "Documentation" },
];

const escapeXml = (value) =>
  value.replace(
    /[<>&'"]/g,
    (char) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        "'": "&apos;",
        '"': "&quot;",
      })[char],
  );

/** @returns {import('astro').AstroIntegration} */
export default function ogImages() {
  return {
    name: "janosik-og-images",
    hooks: {
      "astro:config:setup": async () => {
        // `sharp` ships with Astro; if it is ever unavailable, fall back to the
        // shared `/og.png` rather than breaking the build.
        let sharp;
        try {
          ({ default: sharp } = await import("sharp"));
        } catch {
          return;
        }

        const template = readFileSync(brandOg, "utf8");
        mkdirSync(publicDir, { recursive: true });
        await Promise.all(
          pages.map(async ({ slug, subtitle }) => {
            const svg = template.replace(
              /(<text x="98" y="466"[^>]*>)[^<]*(<\/text>)/,
              `$1${escapeXml(subtitle)}$2`,
            );
            await sharp(Buffer.from(svg))
              .png()
              .toFile(resolve(publicDir, `${slug}.png`));
          }),
        );
      },
    },
  };
}
