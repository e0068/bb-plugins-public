// @vitest-environment node
import { describe, expect, it } from "vitest";

import { windowChromeCss } from "./chrome-css";

/** Правила таблицы: список селекторов и тело каждого. */
const rules = (css: string): { selectors: string[]; body: string }[] =>
  css
    .split("}")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk !== "")
    .map((chunk) => {
      const [head, body] = chunk.split("{");
      return { selectors: head.split(",").map((s) => s.trim()), body: body.trim() };
    });

const bodyOf = (css: string, selector: string): string =>
  rules(css).find((r) => r.selectors.includes(selector))?.body ?? "";

describe("таблица стилей Window Chrome", () => {
  const css = windowChromeCss();

  it("каждый селектор привязан к десктопной раскладке с островом — браузерный вид bb не меняется", () => {
    const unscoped = rules(css).flatMap((r) => r.selectors).filter((s) => !s.includes("[data-framed]"));
    expect(unscoped).toEqual([]);
  });

  it("без темы окна остров отстоит от края окна на 4 px сверху, справа и снизу, а фон за ним чёрный", () => {
    const root = bodyOf(css, `[data-testid="app-layout-root"][data-framed]`);
    expect(root).toContain("--wc-top: 4px;");
    expect(root).toContain("--wc-lip: var(--wc-theme-lip, 4px);");
    expect(root).toContain("padding-top: var(--wc-top);");
    expect(root).toContain("--bb-window-frame-lip: var(--wc-lip);");
    expect(root).toContain("background: var(--wc-theme-backdrop, #000000);");
  });

  it("скругление острова берётся из темы окна, без неё — 0.75rem, как у bb", () => {
    const sidebar = `[data-framed] [data-testid="nav-rail-sidebar-body"]`;
    const page = `[data-framed] main[data-sidebar="inset"]`;
    expect(bodyOf(css, `${sidebar}.rounded-tl-xl`)).toBe("border-top-left-radius: var(--wc-theme-island-radius, 0.75rem);");
    expect(bodyOf(css, `${page}.rounded-br-xl`)).toBe("border-bottom-right-radius: var(--wc-theme-island-radius, 0.75rem);");
    expect(bodyOf(css, sidebar)).toContain("round var(--wc-theme-island-radius, 0.75rem) 0 0 var(--wc-theme-island-radius, 0.75rem)");
  });

  it("со скрытой панелью тредов шапка правой панели во весь экран отступает под три кнопки угла", () => {
    const header = `[data-framed]:has(> [data-state="collapsed"]) [data-panel-id="thread-detail-secondary-panel"][data-panel-size="100.0"] [data-testid="thread-secondary-panel-top-chrome"]`;
    expect(bodyOf(css, header)).toBe("padding-left: calc(3 * var(--wc-button) + 3 * var(--wc-gap) + var(--wc-header-pad));");
  });

  it("в обычном окне отступ сверху 48 px", () => {
    const windowed = rules(css).find((r) => r.selectors.some((s) => s.includes(".pl-\\[84px\\]")));
    expect(windowed?.body).toBe("--wc-top: 48px;");
  });

  it("скрытие левой панели — в левом углу панели, назад и вперёд — у её правого края на любой странице рейки, скрытие правой — в правом углу острова", () => {
    const bar = `[data-framed] > [data-testid="app-window-title-bar"]`;
    expect(bodyOf(css, `${bar} > :has(> [data-sidebar="trigger"])`)).toMatch(/^left: /);
    expect(bodyOf(css, `${bar} > :has(> [data-sidebar-history-shortcut-hints])`)).toContain("right: calc(anchor(right)");
    expect(bodyOf(css, `[data-framed] [data-testid$="-sidebar-top-reserve-row"]`)).toContain("anchor-name: --wc-sidebar-top;");
    expect(bodyOf(css, `${bar} > :has(> [data-testid="window-right-panel-toggle"])`)).toMatch(/^right: /);
  });

  it("со скрытой панелью тредов назад и вперёд встают в левый угол острова", () => {
    const collapsed = `[data-framed]:has(> [data-state="collapsed"]) > [data-testid="app-window-title-bar"] > :has(> [data-sidebar-history-shortcut-hints])`;
    expect(bodyOf(css, collapsed)).toMatch(/^position-anchor: none;\n\s*left: [^;]+;\n\s*right: auto;$/);
  });

  it("место под кнопку правой панели в шапке страницы — только пока кнопка есть и панель закрыта", () => {
    const padded = rules(css).find((r) => r.selectors.some((s) => s.includes("window-right-panel-toggle")) && r.body.startsWith("padding-right"));
    expect(padded?.selectors[0]).toBe(
      `[data-framed]:has([data-testid="window-right-panel-toggle"][aria-expanded="false"]) [data-testid="app-page-header-content-row"]`,
    );
  });

  it("кнопки рейки стоят с шагом строк тредов внутри проекта — зазор 2 px вместо 10 px", () => {
    expect(bodyOf(css, `[data-framed] [data-testid="app-nav-rail"] > nav > div`)).toBe("gap: 0.125rem;");
  });

  it("сдвиг bb на 2 px под светофор снят — кнопки и шапки на одной оси", () => {
    const flattened = rules(css).find((r) => r.body === "transform: none;");
    expect(flattened?.selectors).toEqual([
      `[data-framed] > [data-testid="app-window-title-bar"] [data-sidebar="trigger"]`,
      `[data-framed] [data-testid="app-page-header-content-row"]`,
      `[data-framed] [data-testid="thread-secondary-panel-top-chrome"]`,
    ]);
  });
});
