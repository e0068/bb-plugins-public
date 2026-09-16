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
 * Слои плагина снизу вверх. Папка импортирует только папки из слоёв ниже
 * своего: ни вверх, ни вбок внутри слоя. Таблица «Layers» в README
 * пересказывает этот список словами; порядок задан здесь и только здесь.
 */
const LAYERS: Layers = [
  ["shared", "lib", "hooks"],
  ["db"],
  ["threads", "analytics", "components"],
  ["filesync", "editor"],
  ["attachments", "steer", "client"],
  ["api"],
  ["delegate"],
  ["cli", "folders", "lifecycle", "mentions"],
  ["views"],
  ["shell"],
  ["app", "server"],
];

const ROOT = fileURLToPath(new URL(".", import.meta.url));

describe("plugin layers", () => {
  it("every import between folders points to a strictly lower layer", () => {
    const edges = crossUnitEdges(readSourceFiles(ROOT), { aliases: { "@/": "" } });
    expect(formatViolations(layerViolations(edges, LAYERS))).toBe("");
  });
});
