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
      ...mapper,
    },
    {
      displayName: "e2e",
      testMatch: ["<rootDir>/test/**/*.e2e-spec.ts"],
      transform: tsJest,
      transformIgnorePatterns,
      ...mapper,
    },
  ],
};
