// @vitest-environment node
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { crossUnitEdges, formatViolations, layerViolations, readSourceFiles, type Layers } from "@bb-plugins/layer-guard/index.js";

/**
 * Слои плагина снизу вверх: `core` — чистые таблица окна и тема окна,
 * `shared` — контракт RPC, общий для сервера и фронта, `server` (`server.ts`) —
 * хранение темы и файл темы bb, `app` и `app.tsx` — content-скрипт, форма темы
 * и её живое применение. Порядок задан здесь и только здесь.
 */
const LAYERS: Layers = [["core"], ["shared"], ["server"], ["app"]];

const ROOT = fileURLToPath(new URL(".", import.meta.url));

describe("слои плагина", () => {
  it("каждый импорт между папками указывает строго вниз", () => {
    expect(formatViolations(layerViolations(crossUnitEdges(readSourceFiles(ROOT)), LAYERS))).toBe("");
  });
});
