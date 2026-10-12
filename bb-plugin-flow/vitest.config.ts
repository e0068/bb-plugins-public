// Vitest не читает tsconfig `paths`: алиас "@/*" повторяется здесь. Окружение
// задаётся докблоком `@vitest-environment` в самих файлах — ядру и бэкенду нужен
// node, виду jsdom.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

import { reactDedupe } from "./packages/plugin-base/vitest-react-dedupe";
import { sharedPackagesAlias } from "./packages/plugin-base/vitest-shared-packages";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)), ...sharedPackagesAlias },
    dedupe: reactDedupe,
  },
  test: { setupFiles: ["./test-setup.ts"] },
});
