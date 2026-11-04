import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const version = pkg.version;
const versionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

if (typeof version !== "string" || !versionPattern.test(version)) {
  throw new Error("Root package.json must have a valid release version.");
}
if (lock.version !== version || lock.packages?.[""]?.version !== version) {
  throw new Error("Root package-lock.json versions must match package.json.");
}
const tag = process.env.RELEASE_TAG;
if (tag && tag !== `v${version}`) {
  throw new Error(
    `Release tag ${tag} does not match package.json version ${version}.`,
  );
}
console.log(`Release version verified: ${version}${tag ? ` (${tag})` : ""}`);
