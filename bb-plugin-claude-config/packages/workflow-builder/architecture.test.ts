// @vitest-environment node
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { bundledImports, crossUnitEdges, formatViolations, HOST_SHIMMED, layerViolations, readSourceFiles, type Layers } from "../layer-guard/index.js";

/**
 * Слои пакета снизу вверх: чистое ядро конструктора в корне (модель, операции над деревом, хранилище),
 * над ним экран на React. Ядро не знает про React: его разбирают и собирают сервер Claude Config и
 * инструменты агента во Flow.
 */
const LAYERS: Layers = [["model", "agents"], ["outline-ops", "validity"], ["store"], ["identity"], ["react"]];

const ROOT = fileURLToPath(new URL(".", import.meta.url));

describe("пакет workflow-builder", () => {
  it("каждый импорт между частями пакета указывает строго вниз", () => {
    expect(formatViolations(layerViolations(crossUnitEdges(readSourceFiles(ROOT)), LAYERS))).toBe("");
  });

  it("нетестовый код пакета не импортирует сторонних модулей, кроме подменённых bb", () => {
    const external = bundledImports(readSourceFiles(ROOT), HOST_SHIMMED).filter(({ specifier }) => !specifier.startsWith("node:"));
    expect(external).toEqual([]);
  });
});
