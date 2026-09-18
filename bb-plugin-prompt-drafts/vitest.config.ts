// Vitest не читает tsconfig `paths`: алиас "@/*" повторяется здесь. Окружение
// задаётся докблоком `@vitest-environment` в самих файлах — ядру и серверу
// нужен node, компонентам jsdom.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

import { reactDedupe } from "./packages/plugin-base/vitest-react-dedupe";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
    dedupe: reactDedupe,
  },
});
