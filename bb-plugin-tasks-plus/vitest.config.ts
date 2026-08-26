import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Mirror the tsconfig "@/*" -> "./*" path so UI modules resolve in tests.
      "@": rootDir.replace(/\/$/, ""),
      // tippy.js (via @tiptap/extension-bubble-menu) only ships a CJS main;
      // point vitest at the ESM build so `import tippy` gets the function.
      "tippy.js": "tippy.js/dist/tippy.esm.js",
    },
    // Shared ../../packages import "react" from their own location; without
    // dedupe vitest loads a second React and hooks throw. esbuild dedupes at
    // build time, so this only matters for tests.
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
  },
  test: {
    name: "bb-plugin-tasks-plus",
    environment: "jsdom",
    testTimeout: 20_000,
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", "dist/**"],
    server: {
      deps: {
        inline: ["@tiptap/extension-bubble-menu"],
      },
    },
  },
});
