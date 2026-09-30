import { defineConfig } from "vitest/config";

import { radixDedupe, reactDedupe } from "../plugin-base/vitest-react-dedupe";

export default defineConfig({
  resolve: {
    // A single React instance for rendering the component in tests, and a
    // single Radix instance behind the shared SegmentedControl the header
    // renders (see packages/plugin-base/vitest-react-dedupe.ts).
    dedupe: [...reactDedupe, ...radixDedupe],
  },
});
