import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Backend/core tests run in node; frontend (app.tsx) tests opt into jsdom with a
// per-file `// @vitest-environment jsdom` pragma, matching the SDK harness docs.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
    // Shared packages under ../packages import "react" from their own location;
    // without dedupe vitest loads a second React copy and hooks throw
    // "Cannot read properties of null (reading 'useState')". esbuild already
    // dedupes at build time, so this only matters for tests.
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
  },
  test: {
    environment: "node",
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules", "dist"],
    setupFiles: ["./test-setup.ts"],
  },
});
