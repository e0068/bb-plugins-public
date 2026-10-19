// @vitest-environment jsdom
// Таблица против разметки bb, а не против своего текста: правило, которое
// разметку не находит, проходит строковые тесты и молча ломает окно.
import { beforeEach, describe, expect, it } from "vitest";

import { windowChromeCss } from "./chrome-css";

/** Строка заголовка десктопного bb 0.46.1 со скрытой правой панелью — снята с бандла bb. */
const BB_0461 = `
<div data-testid="app-layout-root" data-framed="">
  <div data-testid="app-window-title-bar" class="fixed inset-x-0 top-0 flex pl-[12px]">
    <div data-wc="group" class="flex items-center">
      <div data-wc="back-forward" class="relative flex items-center">
        <span data-sidebar-history-shortcut-hints=""></span>
        <button aria-label="Go back"></button>
        <button aria-label="Go forward"></button>
      </div>
      <div data-wc="trigger" class="relative flex items-center">
        <button data-sidebar="trigger"></button>
      </div>
    </div>
    <div data-wc="right" class="relative flex items-center ml-auto">
      <button data-testid="window-right-panel-toggle" aria-expanded="false"></button>
    </div>
  </div>
  <div data-state="expanded"></div>
</div>`;

/** Правила таблицы: список селекторов и тело каждого. */
const rules = windowChromeCss()
  .split("}")
  .map((chunk) => chunk.trim())
  .filter((chunk) => chunk !== "")
  .map((chunk) => {
    const [head, body] = chunk.split("{");
    return { selectors: head.split(",\n").map((s) => s.trim()), body: body.trim() };
  });

/** Все объявления таблицы, которые достаются узлу. */
const declarationsOf = (role: string): string => {
  const node = document.querySelector(`[data-wc="${role}"]`);
  if (node === null) throw new Error(`в разметке нет узла ${role}`);
  return rules
    .filter((r) => r.selectors.some((s) => node.matches(s)))
    .map((r) => r.body)
    .join("\n");
};

describe("кнопки строки заголовка на разметке bb 0.46.1", () => {
  beforeEach(() => {
    document.body.innerHTML = BB_0461;
  });

  it("общая обёртка кнопок растворяется и не закрепляется сама — иначе кнопки уезжают к рейке", () => {
    const group = declarationsOf("group");
    expect(group).toContain("display: contents;");
    expect(group).not.toContain("position: fixed;");
  });

  it("скрытие левой панели закреплено в левом углу первой строки панели тредов", () => {
    const trigger = declarationsOf("trigger");
    expect(trigger).toContain("position: fixed;");
    expect(trigger).toMatch(/left: calc\(var\(--wc-rail\)/);
  });

  it("назад и вперёд закреплены у правого края первой строки панели тредов", () => {
    const backForward = declarationsOf("back-forward");
    expect(backForward).toContain("position: fixed;");
    expect(backForward).toContain("right: calc(anchor(right)");
  });

  it("со скрытой панелью тредов назад и вперёд встают вплотную за кнопкой панели, сдвинутой к вертикали иконок", () => {
    document.querySelector(`[data-state]`)?.setAttribute("data-state", "collapsed");
    expect(declarationsOf("back-forward")).toContain(
      "left: calc(var(--wc-rail) + var(--wc-inset) - var(--wc-icon-pad) + var(--wc-button) + var(--wc-gap));",
    );
  });

  it("скрытие правой панели закреплено в правом углу острова", () => {
    const right = declarationsOf("right");
    expect(right).toContain("position: fixed;");
    expect(right).toMatch(/right: calc\(var\(--wc-lip\)/);
  });
});

/** Первые строки панелей рейки bb 0.46.1: у настроек в строке поле поиска, у пустой панели — ничего. */
const TOP_ROWS = `
<div data-testid="app-layout-root" data-framed="">
  <div data-wc="settings-row" data-testid="settings-sidebar-top-reserve-row"><input placeholder="Search" /></div>
  <div data-wc="empty-row" data-testid="skills-sidebar-top-reserve-row"></div>
</div>`;

describe("первая строка панели под кнопками угла", () => {
  beforeEach(() => {
    document.body.innerHTML = TOP_ROWS;
  });

  it("поле поиска в настройках уходит строкой ниже, под кнопки, и не наползает на них", () => {
    const row = declarationsOf("settings-row");
    expect(row).toContain("padding-top: var(--bb-app-chrome-row-height);");
    expect(row).toContain("height: calc(var(--bb-app-chrome-row-height) + 32px);");
  });

  it("пустая первая строка панели остаётся высотой в одну строку", () => {
    const row = declarationsOf("empty-row");
    expect(row).not.toContain("padding-top");
    expect(row).toContain("height: var(--bb-app-chrome-row-height);");
  });
});
