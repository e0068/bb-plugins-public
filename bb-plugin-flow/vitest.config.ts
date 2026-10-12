// Vitest не читает tsconfig `paths`: алиас "@/*" повторяется здесь. Окружение
// задаётся докблоком `@vitest-environment` в самих файлах — ядру и бэкенду нужен
// node, виду jsdom.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

import { mdDocViewDedupe, radixDedupe, reactDedupe } from "./packages/plugin-base/vitest-react-dedupe";
import { sharedPackagesAlias } from "./packages/plugin-base/vitest-shared-packages";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)), ...sharedPackagesAlias },
    // Файл агента в конструкторе workflow — просмотрщик packages/md-doc-view: его Radix и дифф берутся из Flow, иначе второй React.
    dedupe: [...reactDedupe, ...radixDedupe, ...mdDocViewDedupe],
  },
  test: { setupFiles: ["./test-setup.ts"] },
});
