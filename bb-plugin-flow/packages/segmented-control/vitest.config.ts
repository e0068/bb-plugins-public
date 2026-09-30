import { defineConfig } from "vitest/config";

import { reactDedupe } from "../plugin-base/vitest-react-dedupe";

export default defineConfig({
  resolve: {
    dedupe: reactDedupe,
  },
  test: {
    name: "segmented-control",
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
  },
});
