import { afterEach, describe, expect, it, vi } from "vitest";
import { registerServiceWorker } from "./register-sw";

type Env = { PROD: boolean; DEV: boolean };

const envBackup = { ...import.meta.env } as Env;
const nav = globalThis.navigator as unknown as Record<string, unknown>;

function setEnv(env: Partial<Env>): void {
  Object.assign(import.meta.env, env);
}

/** Fresh module state (`announced`/`reloading`) per test. */
async function freshModule(): Promise<typeof import("./register-sw")> {
  vi.resetModules();
  return import("./register-sw");
}

/** A controllable registration + the `navigator.serviceWorker` around it. */
function fakeServiceWorkerContainer(registration: Record<string, unknown>) {
  nav.serviceWorker = {
    controller: {} as unknown as ServiceWorker,
    addEventListener: vi.fn(),
    register: vi.fn(() => Promise.resolve(registration)),
    getRegistration: vi.fn(() => Promise.resolve(registration)),
  };
  return registration;
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
    nav.serviceWorker = { register, addEventListener: vi.fn() };

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
    nav.serviceWorker = { register, addEventListener: vi.fn() };

    registerServiceWorker();

    expect(register).toHaveBeenCalledWith("/sw.js");
  });

  it("swallows registration failures", () => {
    setEnv({ PROD: true, DEV: false });
    const register = vi.fn().mockRejectedValue(new Error("insecure context"));
    nav.serviceWorker = { register, addEventListener: vi.fn() };

    expect(() => registerServiceWorker()).not.toThrow();
  });
});

describe("update announcements (TASK-156 review)", () => {
  it("announces a waiting update once per worker instance", async () => {
    setEnv({ PROD: true, DEV: false });
    const workerA = { state: "installed", postMessage: vi.fn() };
    const workerB = { state: "installed", postMessage: vi.fn() };
    const registration = fakeServiceWorkerContainer({
      waiting: workerA,
      installing: null,
      update: vi.fn(() => Promise.resolve()),
      addEventListener: vi.fn(),
    });
    const { registerServiceWorker, UPDATE_EVENT } = await freshModule();

    const updates = vi.fn();
    window.addEventListener(UPDATE_EVENT, updates);
    try {
      registerServiceWorker();
      // The already-waiting worker is announced when registration lands.
      await vi.waitFor(() => expect(updates).toHaveBeenCalledTimes(1));

      // Focus refreshes find the SAME waiting worker: a dismissed banner
      // must not reappear on every focus while that worker waits.
      window.dispatchEvent(new Event("focus"));
      await vi.waitFor(() => expect(registration.update).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 0));
      window.dispatchEvent(new Event("focus"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(updates).toHaveBeenCalledTimes(1);

      // A different waiting worker (another deploy landed) is news again.
      registration.waiting = workerB;
      window.dispatchEvent(new Event("focus"));
      await vi.waitFor(() => expect(updates).toHaveBeenCalledTimes(2));
    } finally {
      window.removeEventListener(UPDATE_EVENT, updates);
    }
  });
});

describe("applyServiceWorkerUpdate (TASK-156 review)", () => {
  /**
   * jsdom's `location.reload` is unforgeable (it no-ops with a
   * not-implemented notice), so the reload itself is not directly
   * observable here. The branches are still pinned exactly: `update`
   * runs only in the no-waiting branch, `postMessage` only right before
   * the reload in the waiting branch.
   */
  function containerWith(waiting: unknown) {
    const worker = { state: "installed", postMessage: vi.fn() };
    const registration = fakeServiceWorkerContainer({
      waiting: waiting ? worker : null,
      installing: null,
      update: vi.fn(() => Promise.resolve()),
      addEventListener: vi.fn(),
    });
    return { worker, registration };
  }

  it("does not apply (and only refreshes the registration) without a waiting worker", async () => {
    setEnv({ PROD: true, DEV: false });
    const { worker, registration } = containerWith(false);
    const { applyServiceWorkerUpdate } = await freshModule();

    applyServiceWorkerUpdate();
    await vi.waitFor(() => expect(registration.update).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));

    // No waiting worker: no SKIP_WAITING and no reload branch — the
    // registration refresh is all that happens.
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it("posts SKIP_WAITING to the waiting worker (the reload branch)", async () => {
    setEnv({ PROD: true, DEV: false });
    const { worker, registration } = containerWith(true);
    const { applyServiceWorkerUpdate } = await freshModule();

    applyServiceWorkerUpdate();
    await vi.waitFor(() =>
      expect(worker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The waiting branch: postMessage runs (the reload follows it in the
    // same branch); the registration refresh does not.
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(registration.update).not.toHaveBeenCalled();
  });
});
