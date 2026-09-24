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
 * слоёв: ни вверх, ни вбок. Порядок задан здесь и только здесь.
 *
 * `shared` — схемы брифа и контракт RPC; `core` — чистые функции над ними;
 * `server` и `server.ts` — один слой, `app` и `app.tsx` — тоже. Фронт берёт
 * у `shared` только типы: контракт тянет значение из SDK, которого в бандле
 * фронта нет. `tools` — разовые скрипты: оболочка над ядром, рядом с `app`
 * и без права звать его.
 */
const LAYERS: Layers = [
  ["lib"],
  ["shared"],
  ["core"],
  ["components"],
  ["server"],
  ["app", "tools"],
];

const ROOT = fileURLToPath(new URL(".", import.meta.url));

describe("слои плагина", () => {
  it("клиентский код берёт из контракта и бэкенда только типы", () => {
    const valueImport = /^import\s+(?!type\b)[^;]*?from\s+["'][./]*(?:shared\/contract|server)(?:\/[^"']*)?["']/gm;
    expect("import { z } from \"../shared/contract\";".match(valueImport)).not.toBeNull();
    expect("import type { X } from \"../shared/contract\";".match(valueImport)).toBeNull();
    const clientFiles = readSourceFiles(ROOT).filter(
      (file) => /^(app\.tsx|app\/|core\/)/.test(file.path) && !/\.test\.tsx?$/.test(file.path),
    );
    expect(clientFiles.length).toBeGreaterThan(0);
    const offenders = clientFiles.filter((file) => (file.source.match(valueImport) ?? []).length > 0).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("каждый импорт между папками указывает строго вниз", () => {
    const edges = crossUnitEdges(readSourceFiles(ROOT), { aliases: { "@/": "" } });
    expect(formatViolations(layerViolations(edges, LAYERS))).toBe("");
  });
});
