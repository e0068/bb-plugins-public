import { defineConfig } from "vitest/config";

// Node-only package (no React, no DOM) — the plain default environment.
export default defineConfig({
  test: {
    environment: "node",
  },
});
