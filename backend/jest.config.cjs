/** @type {import('jest').Config} */
const tsJest = {
  "^.+\\.ts$": [
    "ts-jest",
    {
      tsconfig: "<rootDir>/tsconfig.json",
    },
  ],
  // A few dependencies ship as ESM only (@nestjs/bullmq, its shared helper).
  // ts-jest compiles them down to CommonJS so the test run can load them.
  "^.+\\.js$": [
    "ts-jest",
    {
      diagnostics: false,
      tsconfig: {
        allowJs: true,
        module: "commonjs",
        target: "ES2022",
        esModuleInterop: true,
        skipLibCheck: true,
      },
    },
  ],
};

// Transform the ESM-only packages inside node_modules (default ignores them).
const transformIgnorePatterns = [
  "/node_modules/(?!(@nestjs/bullmq|@nestjs/bull-shared)/)",
];

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
      transformIgnorePatterns,
      // The 5s default is too tight when the machine is busy (a full CI run
      // executes several workspaces in parallel): a correct test then fails
      // on the clock, not on the assertion. Generous ceiling, no cost on a
      // green run.
      testTimeout: 15_000,
      ...mapper,
    },
    {
      displayName: "e2e",
      testMatch: ["<rootDir>/test/**/*.e2e-spec.ts"],
      transform: tsJest,
      transformIgnorePatterns,
      // e2e walks real HTTP + Postgres: one test can issue dozens of round
      // trips (e.g. the reducer-contract walk), so the 5s default flakes
      // under load. Same rationale as the UI suite's `testTimeout`.
      testTimeout: 30_000,
      ...mapper,
    },
  ],
};
