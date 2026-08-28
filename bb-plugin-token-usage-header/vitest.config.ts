// Vitest doesn't read tsconfig `paths` on its own; the "@/*" alias
// components.json declares (and app.tsx uses for the vendored components/ui)
// needs the same mapping here so tests can import app.tsx directly.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
    // packages/project-switcher (../../packages from pages/) imports "react"
    // from its own location; Vite resolves bare imports by walking up from
    // the importing file's own directory, which for a package outside this
    // plugin's tree never reaches this plugin's node_modules. `dedupe`
    // forces resolution to start from this project's root instead — same
    // fix already applied where other plugins consume ../packages/* (see
    // bb-plugin-workflow-composer/vitest.config.ts, bb-plugin-tasks-plus/
    // vitest.config.ts).
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
  },
});
