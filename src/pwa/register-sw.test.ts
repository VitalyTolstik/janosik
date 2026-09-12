import { afterEach, describe, expect, it, vi } from "vitest";
import { registerServiceWorker } from "./register-sw";

type Env = { PROD: boolean; DEV: boolean };

const envBackup = { ...import.meta.env } as Env;
const nav = globalThis.navigator as unknown as Record<string, unknown>;

function setEnv(env: Partial<Env>): void {
  Object.assign(import.meta.env, env);
}

afterEach(() => {
  setEnv(envBackup);
  delete nav.serviceWorker;
  vi.restoreAllMocks();
});

describe("registerServiceWorker", () => {
  it("no-ops in development", () => {
    setEnv({ PROD: false, DEV: true });
    const register = vi.fn();
    nav.serviceWorker = { register };

    registerServiceWorker();

    expect(register).not.toHaveBeenCalled();
  });

  it("no-ops when service workers are unsupported", () => {
    setEnv({ PROD: true, DEV: false });

    expect(() => registerServiceWorker()).not.toThrow();
  });

  it("registers /sw.js in production", () => {
    setEnv({ PROD: true, DEV: false });
    const register = vi.fn().mockResolvedValue(undefined);
    nav.serviceWorker = { register };

    registerServiceWorker();

    expect(register).toHaveBeenCalledWith("/sw.js");
  });

  it("swallows registration failures", () => {
    setEnv({ PROD: true, DEV: false });
    const register = vi.fn().mockRejectedValue(new Error("insecure context"));
    nav.serviceWorker = { register };

    expect(() => registerServiceWorker()).not.toThrow();
  });
});
