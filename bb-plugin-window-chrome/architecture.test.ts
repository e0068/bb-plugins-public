// @vitest-environment node
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { crossUnitEdges, formatViolations, layerViolations, readSourceFiles, type Layers } from "@bb-plugins/layer-guard/index.js";

/**
 * Слои плагина снизу вверх: `core` — чистая таблица стилей, `server`
 * (`server.ts`) — пустая точка входа, `app` и `app.tsx` — content-скрипт.
 * Порядок задан здесь и только здесь.
 */
const LAYERS: Layers = [["core"], ["server"], ["app"]];

const ROOT = fileURLToPath(new URL(".", import.meta.url));

describe("слои плагина", () => {
  it("каждый импорт между папками указывает строго вниз", () => {
    expect(formatViolations(layerViolations(crossUnitEdges(readSourceFiles(ROOT)), LAYERS))).toBe("");
  });
});
