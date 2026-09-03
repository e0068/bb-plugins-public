import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

import { reactDedupe } from "./packages/plugin-base/vitest-react-dedupe";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
    // Plugin components are imported from ./packages/* and pull in React from
    // that package's node_modules — dedupe collapses all copies to the plugin's
    // node_modules, otherwise hooks break (packages/plugin-base/vitest-react-dedupe.ts).
    dedupe: reactDedupe,
  },
});
