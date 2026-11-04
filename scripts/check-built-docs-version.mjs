import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
for (const lang of ["docs", "ru/docs"]) {
  const path = `site/dist/${lang}/self-hosting/index.html`;
  const html = readFileSync(path, "utf8");
  if (
    !html.includes(`title="Janosik ${version}"`) ||
    !html.includes(`>v${version}</span>`)
  ) {
    throw new Error(`${path} does not display product version ${version}.`);
  }
  console.log(`${path}: v${version}`);
}
