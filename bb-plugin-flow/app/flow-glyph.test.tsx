// @vitest-environment jsdom
// Один значок flow на весь фронт: иконка из подборки этапов, а без неё — знак плагина; «без flow» — знак перечёркнутый.
import type { ReactElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

type FlowGlyphProps = { icon?: string; crossed?: boolean; className?: string };

/**
 * Модуль значка по пути из переменной: пока файла нет, тест падает на ассерте, а не на импорте, и типы проекта сходятся.
 */
const GLYPH_MODULE = "./flow-glyph";
const loadGlyph = async (): Promise<(props: FlowGlyphProps) => ReactElement> => {
  const module = (await import(/* @vite-ignore */ GLYPH_MODULE).catch(() => ({}))) as { FlowGlyph?: unknown };
  expect(module.FlowGlyph, "app/flow-glyph.tsx экспортирует FlowGlyph").toBeTypeOf("function");
  return module.FlowGlyph as (props: FlowGlyphProps) => ReactElement;
};

const draw = async (props: FlowGlyphProps) => {
  const FlowGlyph = await loadGlyph();
  return render(<FlowGlyph {...props} />).container;
};
const mark = (root: Element) => root.querySelector("[data-flow-mark]")?.getAttribute("data-flow-mark") ?? null;

describe("значок flow", () => {
  it("flow с иконкой из подборки рисует её", async () => {
    const root = await draw({ icon: "Rocket", className: "size-3.5" });
    expect(root.querySelector('[data-icon="Rocket"]')).not.toBeNull();
    expect(mark(root)).toBeNull();
    expect(root.querySelector('[data-icon="Rocket"]')!.getAttribute("class")).toContain("size-3.5");
  });

  it("flow без иконки или с неизвестной рисует знак плагина", async () => {
    for (const icon of [undefined, "NoSuchIcon"]) {
      const root = await draw({ icon });
      expect(mark(root)).toBe("plain");
      expect(root.querySelector("[data-icon]")).toBeNull();
      cleanup();
    }
  });

  it("перечёркнутый — знак плагина перечёркнутый даже при иконке", async () => {
    const root = await draw({ icon: "Rocket", crossed: true });
    expect(mark(root)).toBe("crossed");
    expect(root.querySelector('[data-icon="Rocket"]')).toBeNull();
  });
});
