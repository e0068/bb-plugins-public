// @vitest-environment node
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  crossUnitEdges,
  formatViolations,
  layerViolations,
  readSourceFiles,
  type Layers,
} from "./packages/layer-guard/index.js";

/**
 * Слои плагина снизу вверх. Папка импортирует только папки строго нижних
 * слоёв: ни вверх, ни вбок.
 *
 * `server` ниже `ui` не по важности, а по факту: фронт берёт у сервера тип
 * контракта RPC, и обратной зависимости нет.
 */
const LAYERS: Layers = [["lib"], ["components"], ["core"], ["server"], ["ui"], ["app"]];

const ROOT = fileURLToPath(new URL(".", import.meta.url));

describe("слои плагина", () => {
  it("каждый импорт между папками указывает строго вниз", () => {
    const edges = crossUnitEdges(readSourceFiles(ROOT), { aliases: { "@/": "" } });
    expect(formatViolations(layerViolations(edges, LAYERS))).toBe("");
  });
});
