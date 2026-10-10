// @vitest-environment node
import { describe, expect, it } from "vitest";

import { BUILT_IN_THEMES, effectiveDefault, NUMBER_GROUPS, parseThemeValues, SPACING_STEPS, themeCss, themeId, withBackdrop, withColor, withNumber, type ThemeValues } from "./theme";

/** Блок таблицы по его селектору — тело без фигурных скобок. */
const blockOf = (css: string, selector: string): string => {
  const start = css.indexOf(`${selector} {\n`);
  if (start < 0) return "";
  const body = css.slice(start + selector.length + 3);
  return body.slice(0, body.indexOf("\n}"));
};

describe("тема окна — CSS", () => {
  it("без значений таблица пустая: всё остаётся как в теме bb", () => {
    expect(themeCss({}, "live")).toBe("");
    expect(themeCss({}, "file")).toBe("");
  });

  it("цвет светлой темы попадает только в светлый блок, тёмной — только в тёмный", () => {
    const css = themeCss({ light: { primary: "#2e6f95" }, dark: { canvas: "#101010" } }, "file");
    expect(blockOf(css, ":root, .light")).toBe("  --primary: #2e6f95;");
    expect(blockOf(css, ".dark")).toBe("  --canvas: #101010;");
  });

  it("файл темы и живое применение различаются только селекторами", () => {
    const values: ThemeValues = { light: { ink: "#111111" }, dark: { ink: "#eeeeee" }, radius: 6, backdrop: "#202020" };
    const live = themeCss(values, "live")
      .replace(":root:not(.dark)", ":root, .light")
      .replace(":root.dark", ".dark")
      .replace("html:root", ":root");
    expect(live).toBe(themeCss(values, "file"));
  });

  it("скругления, размеры, фон и поля острова ложатся в переменные корня в px", () => {
    const css = themeCss({ radius: 6, islandRadius: 16, lip: 8, sizeStep: 5, chromeRow: 56, listRow: 32, fontSize: 14, backdrop: "#123456" }, "live");
    expect(blockOf(css, "html:root").split("\n").map((line) => line.trim())).toEqual([
      "--radius: 6px;",
      "--spacing: 5px;",
      "--bb-app-chrome-row-height: 56px;",
      "--bb-sidebar-row-height: 32px;",
      "--text-sm: 14px;",
      "--wc-theme-lip: 8px;",
      "--wc-theme-island-radius: 16px;",
      "--wc-theme-backdrop: #123456;",
    ]);
  });

  it("шаг отступов, равный шагу размеров, правил утилит не даёт — bb и так считает от него", () => {
    expect(themeCss({ padStep: 4 }, "live")).not.toContain("@layer");
    expect(themeCss({ sizeStep: 6, padStep: 6 }, "live")).not.toContain("@layer");
  });

  it("разведённый шаг паддингов перекрывает только утилиты паддингов, с вариантами sm, md и pointer-fine", () => {
    const css = themeCss({ padStep: 6 }, "live");
    expect(blockOf(css, "html:root")).toBe("  --wc-pad: 6px;");
    expect(css).toContain(".p-0\\.5 { padding: calc(var(--wc-pad) * 0.5); }");
    expect(css).toContain(".px-2 { padding-inline: calc(var(--wc-pad) * 2); }");
    expect(css).toContain(".md\\:pt-4 { padding-top: calc(var(--wc-pad) * 4); }");
    expect(css).toContain("@media (pointer: fine) {\n.pointer-fine\\:p-0\\.5 { padding: calc(var(--wc-pad) * 0.5); }");
    expect(css).not.toContain("margin");
    expect(css).not.toContain("gap");
  });

  it("варианты bb для узкого окна и контейнера повторены — иначе базовый класс темы перебил бы их", () => {
    const css = themeCss({ padStep: 6, gapStep: 2 }, "live");
    expect(css).toContain("@media (width < 48rem) {\n.max-md\\:p-0\\.5");
    expect(css).toContain(".\\@md\\:gap-2 { gap: calc(var(--wc-gap-step) * 2); }");
    expect(css).toContain("@container (width >= 28rem) {");
  });

  it("линии красят и рамки полей, панели тредов и швы острова; статусы — и свой текст", () => {
    const css = themeCss({ dark: { border: "#ff0000", warning: "#ffaa00", destructive: "#cc0000" } }, "file");
    expect(blockOf(css, ".dark").split("\n").map((line) => line.trim())).toEqual([
      "--border: #ff0000;",
      "--input: #ff0000;",
      "--sidebar-border: #ff0000;",
      "--border-hairline: #ff0000;",
      "--border-seam: #ff0000;",
      "--warning: #ffaa00;",
      "--warning-text: #ffaa00;",
      "--destructive: #cc0000;",
      "--destructive-text: #cc0000;",
    ]);
  });

  it("марджины перекрываются и с минусом, гэпы — по осям", () => {
    const css = themeCss({ marginStep: 3, gapStep: 2 }, "live");
    expect(css).toContain(".-mt-1 { margin-top: calc(var(--wc-margin) * -1); }");
    expect(css).toContain(".gap-x-1\\.5 { column-gap: calc(var(--wc-gap-step) * 1.5); }");
  });

  it("правила утилит идут в слой утилит bb: варианты bb с данными и состояниями остаются сильнее", () => {
    const css = themeCss({ gapStep: 2 }, "file");
    expect(css.indexOf("@layer utilities {")).toBeGreaterThan(-1);
    const rules = css.match(/^\.[^ ]+ \{/gmu) ?? [];
    expect(rules).toHaveLength(3 * SPACING_STEPS.length * 6);
  });
});

describe("тема окна — разбор значений", () => {
  it("мусор даёт пустые значения", () => {
    expect(parseThemeValues(null)).toEqual({});
    expect(parseThemeValues("x")).toEqual({});
    expect(parseThemeValues([1, 2])).toEqual({});
  });

  it("отбрасывает неизвестные ключи, кривой hex и числа вне пределов, hex приводит к строчным", () => {
    const parsed = parseThemeValues({
      light: { primary: "#2E6F95", canvas: "#ffffff", nope: "#000000" },
      dark: { ink: "red" },
      radius: 99,
      islandRadius: 10,
      fontSize: Number.NaN,
      backdrop: "#000000",
      extra: true,
    });
    expect(parsed).toEqual({ light: { primary: "#2e6f95", canvas: "#ffffff" }, islandRadius: 10, backdrop: "#000000" });
  });

  it("пустое поле шага отступов идёт за шагом размеров, остальные — за значением bb", () => {
    const fields = NUMBER_GROUPS.flatMap((g) => g.items);
    const field = (id: string) => fields.find((f) => f.id === id)!;
    expect(effectiveDefault({}, field("padStep"))).toBe(4);
    expect(effectiveDefault({ sizeStep: 6 }, field("padStep"))).toBe(6);
    expect(effectiveDefault({ sizeStep: 6 }, field("gapStep"))).toBe(6);
    expect(effectiveDefault({ sizeStep: 6 }, field("lip"))).toBe(4);
    expect(effectiveDefault({ sizeStep: 6 }, field("fontSize"))).toBe(13);
  });

  it("у каждого числового поля значение bb лежит в его пределах", () => {
    for (const field of NUMBER_GROUPS.flatMap((g) => g.items)) {
      expect(field.bb).toBeGreaterThanOrEqual(field.min);
      expect(field.bb).toBeLessThanOrEqual(field.max);
    }
  });
});

describe("id темы из имени", () => {
  it("латиница с пробелами становится id через дефис", () => {
    expect(themeId("Ocean Blue")).toBe("ocean-blue");
    expect(themeId("  my-theme-2 ")).toBe("my-theme-2");
  });

  it("кириллица, пустое имя и встроенные темы bb не годятся", () => {
    expect(themeId("Моя тема")).toBeNull();
    expect(themeId("")).toBeNull();
    for (const id of BUILT_IN_THEMES) expect(themeId(id)).toBeNull();
  });
});

describe("правка значений", () => {
  it("цвет ставится строчными в свою тему, сброс убирает ключ, а пустая палитра уходит целиком", () => {
    const set = withColor({}, "dark", "primary", "#ABCDEF");
    expect(set).toEqual({ dark: { primary: "#abcdef" } });
    expect(withColor(set, "dark", "primary", null)).toEqual({});
    expect(withColor({ light: { ink: "#111111", border: "#222222" } }, "light", "ink", null)).toEqual({ light: { border: "#222222" } });
  });

  it("фон за островом и числа ставятся и сбрасываются, не трогая остальное", () => {
    const values: ThemeValues = { radius: 6, light: { ink: "#111111" } };
    expect(withBackdrop(values, "#202020")).toEqual({ ...values, backdrop: "#202020" });
    expect(withBackdrop({ ...values, backdrop: "#202020" }, null)).toEqual(values);
    expect(withNumber(values, "fontSize", 14)).toEqual({ ...values, fontSize: 14 });
    expect(withNumber(values, "radius", null)).toEqual({ light: { ink: "#111111" } });
  });
});
