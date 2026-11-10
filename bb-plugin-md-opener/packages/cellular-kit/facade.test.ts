// Обещание фасада cellular-kit: типизированные фабрики отдают разметку kit как есть.
import { describe, expect, it } from "vitest";

import { button, input, segment, toggle, uiCell, uiRow } from "./index";

describe("фасад над фабриками kit", () => {
  it("кнопка — ячейка kit с подписью", () => {
    const el = button({ label: "Count" });
    expect(el.className).toContain("uicell");
    expect(el.textContent).toContain("Count");
  });

  it("сегмент — группа кнопок kit, активна одна", () => {
    const el = segment({ items: [{ label: "A" }, { label: "B" }], value: 1 });
    expect(el.className).toContain("uisegment");
    expect(el.querySelectorAll("button.on")).toHaveLength(1);
  });

  it("переключатель — строка kit с чекбоксом в состоянии get()", () => {
    const el = toggle({ label: "Managed", get: () => true, set: () => {} });
    expect(el.className).toContain("uiswitch");
    expect(el.querySelector<HTMLInputElement>("input[type=checkbox]")?.checked).toBe(true);
  });

  it("поле ввода — ячейка kit с текстовым полем и плейсхолдером", () => {
    const el = input({ placeholder: "Search" });
    expect(el.querySelector<HTMLInputElement>(".cinp")?.placeholder).toBe("Search");
  });

  it("ячейка и строка — базовые контейнеры kit", () => {
    expect(uiCell({ label: "id" }).className).toContain("uicell");
    expect(uiRow().className).toBe("uirow");
  });
});
