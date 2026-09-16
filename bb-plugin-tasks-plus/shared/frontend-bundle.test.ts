// @vitest-environment node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Фронтенд-бандл собирается без серверного SDK: хост шимит `@get-bb/plugin-sdk`
 * только для серверной сборки, поэтому импорт значения из `shared/contract.ts`
 * (он этот SDK тянет) роняет установку плагина из git целиком —
 * `Could not resolve "@get-bb/plugin-sdk"`. Типы стираются при компиляции и
 * потому разрешены; значения — нет, им место в `shared/enums.ts`.
 *
 * Сторож существует потому, что цена ошибки несоразмерна её виду: одна строка
 * импорта, тесты зелёные, а плагин не ставится ни у кого.
 */
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FRONTEND_DIRS = [
  "client",
  "views",
  "shell",
  "components",
  "editor",
  "hooks",
  "lib",
];
const FRONTEND_FILES = ["app.tsx"];

/** Импортирует ли исходник значения (не только типы) из указанного модуля. */
export function importsValuesFrom(source: string, moduleSuffix: string): boolean {
  const pattern = /import\s+(type\s+)?([\s\S]*?)from\s+["']([^"']+)["']/g;
  for (const [, typeOnly, clause, specifier] of source.matchAll(pattern)) {
    if (!specifier.endsWith(moduleSuffix)) continue;
    if (typeOnly) continue;
    // `import { type A, type B } from "..."` тоже стирается целиком.
    const names = clause
      .replace(/[{}]/g, "")
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name !== "");
    if (names.length > 0 && names.every((name) => name.startsWith("type "))) continue;
    return true;
  }
  return false;
}

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }
    if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(path);
  }
  return found;
}

describe("importsValuesFrom", () => {
  it("видит импорт значения", () => {
    expect(
      importsValuesFrom('import { CALLER_SCOPED_METHODS } from "../shared/contract.js";', "shared/contract.js"),
    ).toBe(true);
  });

  it("пропускает импорт типов", () => {
    expect(
      importsValuesFrom('import type { Task } from "../shared/contract.js";', "shared/contract.js"),
    ).toBe(false);
  });

  it("пропускает импорт, где каждое имя помечено type", () => {
    expect(
      importsValuesFrom('import { type Task, type Project } from "../shared/contract.js";', "shared/contract.js"),
    ).toBe(false);
  });

});

describe("фронтенд-бандл", () => {
  const files = [
    ...FRONTEND_DIRS.flatMap((dir) => sourceFiles(join(ROOT, dir))),
    ...FRONTEND_FILES.map((file) => join(ROOT, file)),
  ];

  it("собирает файлы, которые попадают в бандл", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("не берёт из shared/contract.ts ничего, кроме типов", () => {
    const offenders = files.filter((file) =>
      importsValuesFrom(readFileSync(file, "utf8"), "shared/contract.js"),
    );
    expect(offenders.map((file) => file.slice(ROOT.length))).toEqual([]);
  });

  it("не берёт из серверного SDK ничего, кроме типов", () => {
    const offenders = files.filter((file) =>
      importsValuesFrom(readFileSync(file, "utf8"), "@get-bb/plugin-sdk"),
    );
    expect(offenders.map((file) => file.slice(ROOT.length))).toEqual([]);
  });
});
