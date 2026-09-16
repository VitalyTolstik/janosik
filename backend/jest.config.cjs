/** @type {import('jest').Config} */
const tsJest = {
  "^.+\\.ts$": [
    "ts-jest",
    {
      tsconfig: "<rootDir>/tsconfig.json",
    },
  ],
};

module.exports = {
  testEnvironment: "node",
  projects: [
    {
      displayName: "unit",
      testMatch: ["<rootDir>/src/**/*.spec.ts"],
      transform: tsJest,
    },
    {
      displayName: "e2e",
      testMatch: ["<rootDir>/test/**/*.e2e-spec.ts"],
      transform: tsJest,
    },
  ],
};
