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
