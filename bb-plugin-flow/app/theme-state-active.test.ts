// @vitest-environment node
// Подсветка во всём Flow темнее, чем у bb, в обеих темах — переопределение --state-active в theme.css.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Доли цвета текста в --state-active у bb: `:root,.light` и `.dark` его стилей. */
const BB_LIGHT = 11.8;
const BB_DARK = 22.5;

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
const css = read("./theme.css").replace(/\/\*[\s\S]*?\*\//g, "");

/** Доля цвета текста в --state-active правила с этим селектором; правила нет — null. */
const share = (selector: string): number | null => {
  const rule = css.split("}").find((block) => block.split("{")[0]!.trim() === selector);
  const match = rule?.match(/--state-active:\s*color-mix\(in oklab, var\(--ink\) ([\d.]+)%, transparent\)/);
  return match === undefined || match === null ? null : Number(match[1]);
};

describe("--state-active во Flow", () => {
  it("в тёмной теме текст светлый — его доля меньше, чем у bb", () => {
    expect(share('.dark [data-bb-plugin="flow"]')).toBeLessThan(BB_DARK);
  });

  it("в светлой теме текст тёмный — его доля больше, чем у bb, но не вдвое", () => {
    expect(share('[data-bb-plugin="flow"]')).toBeGreaterThan(BB_LIGHT);
    expect(share('[data-bb-plugin="flow"]')).toBeLessThan(BB_LIGHT * 2);
  });

  it("стили подключает вход приложения Flow", () => {
    expect(read("../app.tsx")).toMatch(/^import "\.\/app\/theme\.css";$/m);
  });
});
