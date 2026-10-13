// @vitest-environment node
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HOST_SHIMMED, bundledImports, readSourceFiles } from "../layer-guard/index.js";

/**
 * A plugin installed from git gets `node_modules` only in its own folder, and
 * the bundler resolves a package from the importing file up. This package sits
 * outside the plugin, so every library it needs arrives from the plugin as a
 * prop; here it may import only what the host shims, and types.
 */
describe("git install", () => {
  it("the shared package imports no third-party library by value", () => {
    const files = readSourceFiles(fileURLToPath(new URL(".", import.meta.url)));
    expect(bundledImports(files, HOST_SHIMMED)).toEqual([]);
  });
});
