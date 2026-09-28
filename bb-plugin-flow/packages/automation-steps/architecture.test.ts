// @vitest-environment node
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { bundledImports, crossUnitEdges, formatViolations, HOST_SHIMMED, layerViolations, readSourceFiles, type Layers } from "../layer-guard/index.js";

/** Слои пакета снизу вверх: каталог шагов и чистые решения, эффекты за портами, помощники шагов, шаги, вход. */
const LAYERS: Layers = [["catalog", "core"], ["wiring"], ["shell"], ["steps"], ["index"]];

const ROOT = fileURLToPath(new URL(".", import.meta.url));

describe("пакет automation-steps", () => {
  it("каждый импорт между папками пакета указывает строго вниз", () => {
    expect(formatViolations(layerViolations(crossUnitEdges(readSourceFiles(ROOT)), LAYERS))).toBe("");
  });

  it("нетестовый код пакета не импортирует сторонних модулей", () => {
    const external = bundledImports(readSourceFiles(ROOT), HOST_SHIMMED).filter(({ specifier }) => !specifier.startsWith("node:"));
    expect(external).toEqual([]);
  });
});
