import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  useOnline,
  useServiceWorkerStatus,
  useStandalone,
} from "./use-client-state";

/**
 * The client-side "state of the UI" the master panel reports: the service
 * worker, the install mode and the connection. jsdom ships none of them, so
 * each test stubs exactly what it needs.
 */

function stubServiceWorker(registration: unknown): void {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { getRegistration: vi.fn(async () => registration) },
  });
}

function stubDisplayMode(standalone: boolean): void {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: query.includes("standalone") ? standalone : !standalone,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList,
  );
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "serviceWorker");
  vi.restoreAllMocks();
});

describe("useServiceWorkerStatus", () => {
  it("reports unsupported when the API is absent", () => {
    const { result } = renderHook(() => useServiceWorkerStatus());
    expect(result.current).toBe("unsupported");
  });

  it("reports active when a worker controls the page", async () => {
    stubServiceWorker({ active: {}, installing: null });
    const { result } = renderHook(() => useServiceWorkerStatus());
    await waitFor(() => expect(result.current).toBe("active"));
  });

  it("reports installing while the worker installs", async () => {
    stubServiceWorker({ active: null, installing: {} });
    const { result } = renderHook(() => useServiceWorkerStatus());
    await waitFor(() => expect(result.current).toBe("installing"));
  });

  it("reports unregistered when there is no registration", async () => {
    stubServiceWorker(undefined);
    const { result } = renderHook(() => useServiceWorkerStatus());
    await waitFor(() => expect(result.current).toBe("unregistered"));
  });
});

describe("useOnline", () => {
  it("follows the online and offline events", () => {
    const { result } = renderHook(() => useOnline());
    expect(result.current).toBe(true);

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current).toBe(false);

    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current).toBe(true);
  });
});

describe("useStandalone", () => {
  it("reflects the standalone display mode", () => {
    stubDisplayMode(true);
    const { result } = renderHook(() => useStandalone());
    expect(result.current).toBe(true);
  });

  it("is false in a normal browser tab", () => {
    stubDisplayMode(false);
    const { result } = renderHook(() => useStandalone());
    expect(result.current).toBe(false);
  });
});
