// @vitest-environment jsdom
// Таблица палитры против разметки пирога, которую рисует mermaid внутри bb:
// правило, не нашедшее узел, проходит строковые тесты и молча оставляет пирог серым.
import { afterEach, describe, expect, it } from "vitest";

import { DARK_PIE_PALETTE, LIGHT_PIE_PALETTE, PIE_MARK_ATTR, diagramPaletteCss, pieMark, type PieMark } from "./diagram-palette";
import { FLOWCHART_SVG, pieSvg } from "./pie-fixture";

type Rule = { selectors: string[]; body: string };

const parse = (css: string): Rule[] =>
  css
    .split("}")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk !== "")
    .map((chunk) => {
      const [head, body] = chunk.split("{");
      return { selectors: head.split(",").map((s) => s.trim()), body: body.trim() };
    });

/** Цвет, который таблица даёт узлу: последнее подходящее объявление `fill`, как в каскаде. */
const fillOf = (node: Element): string | null =>
  parse(diagramPaletteCss())
    .filter((r) => r.selectors.some((s) => node.matches(s)))
    .map((r) => /fill:\s*([^;!]+)/.exec(r.body)?.[1]?.trim() ?? null)
    .filter((fill): fill is string => fill !== null)
    .at(-1) ?? null;

/** Кладёт разметку в страницу и ставит пирогам отметку сверки, как её ставит content-скрипт. */
const render = (html: string, mark: PieMark) => {
  document.body.innerHTML = html;
  document.querySelectorAll(`svg[aria-roledescription="pie"]`).forEach((svg) => svg.setAttribute(PIE_MARK_ATTR, mark));
};

const slice = (label: string) => document.querySelector(`[data-slice="${label}"]`)!;
const legendSwatch = (label: string) => document.querySelector(`[data-legend="${label}"] rect`)!;

afterEach(() => {
  document.documentElement.className = "";
  document.body.innerHTML = "";
});

describe("сверка пирога", () => {
  it("пирог выверен, когда у каждой строки легенды есть долька", () => {
    expect(pieMark(3, 3)).toBe("aligned");
    expect(pieMark(1, 1)).toBe("aligned");
  });

  it("секция без дольки — пирог сбит: n-я долька и n-я строка легенды о разном", () => {
    expect(pieMark(2, 3)).toBe("skewed");
    expect(pieMark(0, 2)).toBe("skewed");
    expect(pieMark(0, 0)).toBe("skewed");
  });
});

describe("палитра пирога bb", () => {
  it("в тёмной теме n-я долька и квадратик n-й строки легенды — n-й цвет тёмной палитры", () => {
    document.documentElement.className = "dark";
    const labels = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"];
    render(pieSvg(labels), "aligned");
    labels.forEach((label, i) => {
      expect(fillOf(slice(label))).toBe(DARK_PIE_PALETTE[i]);
      expect(fillOf(legendSwatch(label))).toBe(DARK_PIE_PALETTE[i]);
    });
  });

  it("в светлой теме — те же места, светлая палитра", () => {
    const labels = ["a", "b", "c"];
    render(pieSvg(labels), "aligned");
    labels.forEach((label, i) => {
      expect(fillOf(slice(label))).toBe(LIGHT_PIE_PALETTE[i]);
      expect(fillOf(legendSwatch(label))).toBe(LIGHT_PIE_PALETTE[i]);
    });
  });

  it("тринадцатая долька идёт по кругу с первого цвета, как у mermaid", () => {
    document.documentElement.className = "dark";
    const labels = Array.from({ length: 13 }, (_, i) => `s${i}`);
    render(pieSvg(labels), "aligned");
    expect(fillOf(slice("s12"))).toBe(DARK_PIE_PALETTE[0]);
    expect(fillOf(legendSwatch("s12"))).toBe(DARK_PIE_PALETTE[0]);
  });

  it("сбитый пирог остаётся таким, как его нарисовал bb: легенда не врёт чужим цветом", () => {
    document.documentElement.className = "dark";
    render(pieSvg(["passed", "failed", "skipped"], { drawn: ["passed", "skipped"] }), "skewed");
    document.querySelectorAll("svg *").forEach((node) => expect(fillOf(node)).toBeNull());
  });

  it("пирог без отметки сверки не красится", () => {
    document.body.innerHTML = pieSvg(["a", "b"]);
    document.querySelectorAll("svg *").forEach((node) => expect(fillOf(node)).toBeNull());
  });

  it("квадратик легенды перекрашивается поверх инлайн-стиля mermaid", () => {
    const swatchRules = parse(diagramPaletteCss()).filter((r) => r.selectors.some((s) => s.endsWith("rect")));
    expect(swatchRules.length).toBeGreaterThan(0);
    swatchRules.forEach((r) => expect(r.body).toMatch(/fill:[^;]+!important/));
  });

  it("цвета тёмной и светлой палитры попарно различны", () => {
    expect(new Set(DARK_PIE_PALETTE).size).toBe(DARK_PIE_PALETTE.length);
    expect(new Set(LIGHT_PIE_PALETTE).size).toBe(LIGHT_PIE_PALETTE.length);
  });

  it("блок-схему bb и выверенный пирог чужого рендерера не трогает", () => {
    document.documentElement.className = "dark";
    render(FLOWCHART_SVG + pieSvg(["x", "y"], { id: "mermaid-1" }), "aligned");
    document.querySelectorAll("svg *").forEach((node) => expect(fillOf(node)).toBeNull());
  });
});
