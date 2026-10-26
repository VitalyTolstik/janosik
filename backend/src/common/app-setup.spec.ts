import type { INestApplication } from "@nestjs/common";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

// The real `env` is frozen; a mutable stand-in lets the test drive TRUST_PROXY.
jest.mock("@/config/env", () => ({ env: { TRUST_PROXY: 0 } }));

import { env } from "@/config/env";
import { setupApp } from "./app-setup";

/** TASK-91: `trust proxy` is applied only when the hop count is configured. */
describe("setupApp trust proxy", () => {
  afterEach(() => {
    (env as { TRUST_PROXY: number }).TRUST_PROXY = 0;
  });

  const fakeApp = (): INestApplication =>
    ({
      set: jest.fn(),
      use: jest.fn(),
      useBodyParser: jest.fn(),
      setGlobalPrefix: jest.fn(),
      useGlobalPipes: jest.fn(),
    }) as unknown as INestApplication;

  it("sets trust proxy to the configured hop count", () => {
    (env as { TRUST_PROXY: number }).TRUST_PROXY = 2;
    const app = fakeApp();
    setupApp(app);
    expect((app as unknown as { set: jest.Mock }).set).toHaveBeenCalledWith(
      "trust proxy",
      2,
    );
  });

  it("leaves trust proxy untouched when disabled (0)", () => {
    (env as { TRUST_PROXY: number }).TRUST_PROXY = 0;
    const app = fakeApp();
    setupApp(app);
    expect((app as unknown as { set: jest.Mock }).set).not.toHaveBeenCalled();
  });
});
