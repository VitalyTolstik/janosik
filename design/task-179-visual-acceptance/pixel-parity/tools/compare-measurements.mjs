import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const app = JSON.parse(
  readFileSync(path.join(root, "app-measurements.json"), "utf8"),
);
const mock = JSON.parse(
  readFileSync(path.join(root, "mockup-measurements.json"), "utf8"),
);

for (const key of Object.keys(mock)) {
  const a = app[key];
  const m = mock[key];
  if (a === undefined) continue;
  const fields = [
    "width",
    "height",
    "fontSize",
    "fontWeight",
    "lineHeight",
    "borderRadius",
    "padding",
    "gap",
  ];
  const diffs = fields.filter((field) => a[field] !== m[field]);
  const iconDiff =
    (a.icon?.width ?? null) !== (m.icon?.width ?? null) ||
    (a.icon?.height ?? null) !== (m.icon?.height ?? null);
  if (diffs.length === 0 && !iconDiff) continue;
  console.log(`\n${key}`);
  for (const field of diffs)
    console.log(`  ${field}: app=${a[field]} mock=${m[field]}`);
  if (iconDiff)
    console.log(
      `  icon: app=${JSON.stringify(a.icon)} mock=${JSON.stringify(m.icon)}`,
    );
}
