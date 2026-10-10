// Окружение задаётся докблоком `@vitest-environment` в самих файлах: ядру — node, content-скрипту — jsdom.
import { defineConfig } from "vitest/config";

import { reactDedupe } from "./packages/plugin-base/vitest-react-dedupe";
import { sharedPackagesAlias } from "./packages/plugin-base/vitest-shared-packages";

export default defineConfig({
  resolve: { alias: sharedPackagesAlias, dedupe: reactDedupe },
});
