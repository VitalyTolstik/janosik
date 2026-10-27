// Runs on every commit (see .husky/pre-commit). Prettier formats exactly the
// staged files (each path quoted, so names with spaces survive the shell).
// ESLint checks the owning workspace — its flat config is resolved
// per-workspace, so we delegate via npm -w — without `--fix`, so a commit
// never rewrites files that were not staged.
const quote = (file) => `"${file.replaceAll('"', '\\"')}"`;

export default {
  "*.{ts,tsx,js,mjs,cjs,css,html,json,md,yml,yaml}": (files) =>
    `prettier --write ${files.map(quote).join(" ")}`,
  "ui/**/*.{ts,tsx}": () => "npm run lint -w ui",
  "shared/**/*.ts": () => "npm run lint -w shared",
  "backend/**/*.{ts,js,mjs,cjs}": () => "npm run lint -w backend",
  "mcp/**/*.{ts,mjs}": () => "npm run lint -w mcp",
};
