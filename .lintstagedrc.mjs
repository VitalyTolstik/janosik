// Runs on every commit (see .husky/pre-commit). Prettier formats exactly the
// staged files; ESLint fixes the whole owning workspace (its flat config is
// resolved per-workspace, so we delegate via npm -w).
export default {
  "*.{ts,tsx,js,mjs,cjs,css,html,json,md,yml,yaml}": (files) =>
    `prettier --write ${files.join(" ")}`,
  "ui/**/*.{ts,tsx}": () => "npm run lint -w ui -- --fix",
  "shared/**/*.ts": () => "npm run lint -w shared -- --fix",
  "backend/**/*.{ts,js,mjs,cjs}": () => "npm run lint -w backend -- --fix",
};
