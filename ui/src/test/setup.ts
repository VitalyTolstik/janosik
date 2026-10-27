import "@testing-library/jest-dom/vitest";
import {
  ReadableStream as NodeReadableStream,
  TransformStream as NodeTransformStream,
  WritableStream as NodeWritableStream,
} from "node:stream/web";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

// The default 1s async-utility budget is too tight when the whole suite runs
// in parallel (lazy chunks, SSE settles and fetch round-trips queue behind
// each other): an assertion is correct but the element lands a beat late.
// Matches the generous `testTimeout` in vitest.config.ts — a green run is not
// slowed down, a busy machine no longer flakes.
configure({ asyncUtilTimeout: 5_000 });

// jsdom has no web-stream classes; the SSE reader (TASK-30) and the fake
// server's event streams need them in tests.
if (!("ReadableStream" in globalThis)) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ReadableStream = NodeReadableStream;
}
if (!("WritableStream" in globalThis)) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).WritableStream = NodeWritableStream;
}
if (!("TransformStream" in globalThis)) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).TransformStream = NodeTransformStream;
}

// Auto-cleanup after every test (React Testing Library).
afterEach(() => {
  cleanup();
});

// Isolate every test from cross-file leakage (T-10): persisted data and the
// theme class on <html> otherwise survive because both live outside React.
beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark", "light");
});

// jsdom polyfills for browser APIs required by @dnd-kit and some shadcn
// components when they render in tests (they are no-ops here).
if (!("ResizeObserver" in globalThis)) {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver = ResizeObserverMock;
}

if (typeof window !== "undefined" && !window.matchMedia) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
