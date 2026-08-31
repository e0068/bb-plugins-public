import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

import { reactDedupe } from "./packages/plugin-base/vitest-react-dedupe";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
    // Компоненты плагина импортируются из ./packages/* и тянут React из
    // node_modules пакета — dedupe сводит все копии к node_modules плагина,
    // иначе хуки падают (packages/plugin-base/vitest-react-dedupe.ts).
    dedupe: reactDedupe,
  },
});
