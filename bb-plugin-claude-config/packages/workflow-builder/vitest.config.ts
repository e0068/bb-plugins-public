import { defineConfig } from "vitest/config";

import { reactDedupe } from "../plugin-base/vitest-react-dedupe";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    // One React instance for the builder and the markdown editor it renders (packages/md-editor).
    dedupe: [...reactDedupe],
  },
});
