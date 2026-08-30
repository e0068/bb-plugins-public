import { configure } from "@testing-library/react";

// Match slow CI runners: the default 1s async-utility timeout flakes there
// while the suite-level vitest testTimeout still bounds real hangs.
configure({ asyncUtilTimeout: 8_000 });

// Radix Select scrolls the chosen item into view when its portal opens.
// jsdom does not implement this browser API.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: () => {},
  });
}

// Under vitest's jsdom environment the window exposes no Web Storage, so the
// shell's view-preference persistence (window.localStorage) has nothing to
// call. Provide an in-memory Storage so the whole shell suite can run.
if (typeof window !== "undefined" && !window.localStorage) {
  const memoryStorage = (): Storage => {
    const map = new Map<string, string>();
    return {
      get length() {
        return map.size;
      },
      clear: () => map.clear(),
      getItem: (key) => (map.has(key) ? map.get(key)! : null),
      key: (index) => [...map.keys()][index] ?? null,
      removeItem: (key) => void map.delete(key),
      setItem: (key, value) => void map.set(key, String(value)),
    } satisfies Storage;
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: memoryStorage(),
  });
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: memoryStorage(),
  });
}

// The shared-ui Dialog resolves a responsive layout via matchMedia, which
// jsdom does not implement. Default to the non-compact (desktop) branch.
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
