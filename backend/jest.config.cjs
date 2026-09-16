/** @type {import('jest').Config} */
const tsJest = {
  "^.+\\.ts$": [
    "ts-jest",
    {
      tsconfig: "<rootDir>/tsconfig.json",
    },
  ],
};

const mapper = {
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^@janosik/shared$": "<rootDir>/../shared/src/index.ts",
  },
};

module.exports = {
  testEnvironment: "node",
  projects: [
    {
      displayName: "unit",
      testMatch: ["<rootDir>/src/**/*.spec.ts"],
      transform: tsJest,
      ...mapper,
    },
    {
      displayName: "e2e",
      testMatch: ["<rootDir>/test/**/*.e2e-spec.ts"],
      transform: tsJest,
      ...mapper,
    },
  ],
};
