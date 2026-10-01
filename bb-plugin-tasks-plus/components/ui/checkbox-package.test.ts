// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("the package behind the Checkbox", () => {
  it("is a runtime dependency, so an install from git without devDependencies has it", () => {
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(manifest.dependencies?.["@radix-ui/react-checkbox"]).toBeDefined();
    expect(manifest.devDependencies?.["@radix-ui/react-checkbox"]).toBeUndefined();
  });
});
