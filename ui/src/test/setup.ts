import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

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
