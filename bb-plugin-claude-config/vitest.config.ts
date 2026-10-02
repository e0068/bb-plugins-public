import { defineConfig } from "vitest/config";

import { sharedPackagesAlias } from "./packages/plugin-base/vitest-shared-packages";

export default defineConfig({
  resolve: { alias: sharedPackagesAlias },
});
