// Vitest doesn't read tsconfig `paths` on its own; the "@/*" alias
// components.json declares (and app.tsx uses for the vendored components/ui)
// needs the same mapping here so tests can import app.tsx directly.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { reactDedupe } from "./packages/plugin-base/vitest-react-dedupe";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
    dedupe: reactDedupe,
  },
});
