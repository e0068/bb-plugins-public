import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library only registers its own afterEach cleanup when vitest runs
// with `globals: true`, and this package does not. Without this the DOM of one
// test survives into the next, and a query that should match one node matches
// two — which surfaces as a timeout, not as a duplicate error.
afterEach(cleanup);

// The colour-mode hook subscribes to `prefers-color-scheme`, which jsdom does
// not implement. Default to the light branch, so a test that says nothing
// about the system preference reads the host's own declaration.
if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  });
}
