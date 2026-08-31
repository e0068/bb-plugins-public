import { defineConfig } from "vitest/config";

import { reactDedupe } from "../plugin-base/vitest-react-dedupe";

export default defineConfig({
  resolve: {
    // Один инстанс React для рендера компонента в тесте (см.
    // packages/plugin-base/vitest-react-dedupe.ts).
    dedupe: reactDedupe,
  },
});
