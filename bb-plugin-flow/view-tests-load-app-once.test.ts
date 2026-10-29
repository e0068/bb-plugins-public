// @vitest-environment node
// Тест вида грузит приложение один раз на уровне файла: загрузка в теле теста
// оплачивает трансформацию приложения под таймаутом теста и мигает под нагрузкой (BBPL-991).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP = join(import.meta.dirname, "app");

const loadsInsideTest = (file: string): string[] =>
  readFileSync(join(APP, file), "utf8")
    .split("\n")
    .flatMap((line, index) => (/^\s+.*loadPluginApp\(/.test(line) ? [`${file}:${index + 1}`] : []));

describe("тесты вида Flow", () => {
  it("грузят приложение на уровне файла, а не внутри теста", () => {
    const files = readdirSync(APP).filter((name) => /\.test\.tsx?$/.test(name));
    expect(files.length).toBeGreaterThan(0);
    expect(files.flatMap(loadsInsideTest)).toEqual([]);
  });
});
