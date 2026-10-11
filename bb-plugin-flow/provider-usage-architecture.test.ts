// @vitest-environment node
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { crossUnitEdges, formatViolations, layerViolations, readSourceFiles } from "@bb-plugins/layer-guard/index.js";

describe("provider usage layers", () => {
  it("process and filesystem effects stay above pure normalization and pricing", () => {
    const files = readSourceFiles(fileURLToPath(new URL("./packages/provider-usage/", import.meta.url)));
    expect(files.some((f) => f.path === "core/pricing.ts")).toBe(true);
    expect(formatViolations(layerViolations(crossUnitEdges(files), [["core"], ["shell"]]))).toBe("");
    expect(files.filter((f) => f.path.startsWith("core/")).some((f) => /from ["']node:/.test(f.source))).toBe(false);
  });
});
