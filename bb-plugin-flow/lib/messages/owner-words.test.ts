// @vitest-environment node
// Словарь владельца: всё, что агент присылает, — «виджет», а конкретный — по виду. Слово «бриф» владелец считает неверным,
// и сторож проходит по каждой строке обоих словарей, включая то, что возвращают функции на пробных аргументах.
import { describe, expect, it } from "vitest";

import { en } from "./en";
import { ru } from "./ru";

const SAMPLES: ReadonlyArray<readonly unknown[]> = [["x", "x", "x"], [true, "x", "x"], [false, "x", "x"], [1, 1, 1], [2, "x", "x"], ["continue"], ["comment"]];

/** Все строки словаря с путём: значения и то, что вернули функции; функция, упавшая на пробе, пропускается. */
const texts = (value: unknown, path: string): Array<[string, string]> => {
  if (typeof value === "string") return [[path, value]];
  if (typeof value === "function")
    return SAMPLES.flatMap((args) => {
      try {
        const out: unknown = (value as (...a: unknown[]) => unknown)(...args);
        return typeof out === "string" ? [[path, out] as [string, string]] : [];
      } catch {
        return [];
      }
    });
  if (Array.isArray(value)) return value.flatMap((item, i) => texts(item, `${path}[${i}]`));
  if (value !== null && typeof value === "object") return Object.entries(value).flatMap(([key, item]) => texts(item, path === "" ? key : `${path}.${key}`));
  return [];
};

describe("слово «бриф» в текстах владельца", () => {
  it.each([
    ["ru", ru],
    ["en", en],
  ] as const)("словарь %s его не содержит", (_, dictionary) => {
    const found = texts(dictionary, "").filter(([, text]) => /бриф|brief/i.test(text));
    expect(found).toEqual([]);
  });
});
