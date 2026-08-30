import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { reactDedupe } from "./packages/plugin-base/vitest-react-dedupe";

// Backend/core tests run in node; frontend (app.tsx) tests opt into jsdom with a
// per-file `// @vitest-environment jsdom` pragma, matching the SDK harness docs.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
    dedupe: reactDedupe,
  },
  test: {
    environment: "node",
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules", "dist"],
    setupFiles: ["./test-setup.ts"],
  },
});
