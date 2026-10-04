import { defineConfig } from "vitest/config";

import { reactDedupe } from "../plugin-base/vitest-react-dedupe";

export default defineConfig({
  resolve: {
    // A single React instance for rendering the hook's probe in tests (see
    // packages/plugin-base/vitest-react-dedupe.ts).
    dedupe: reactDedupe,
  },
  test: {
    name: "code-editor",
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
  },
});
