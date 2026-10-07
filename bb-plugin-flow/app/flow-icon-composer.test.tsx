// @vitest-environment jsdom
// Иконка flow в композере: кнопка flow нового треда и её меню, строка выбора flow над композером треда. Flow без иконки,
// «Автоматически» — знак плагина, «Без flow» — знак перечёркнутый.
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

const app = await loadPluginApp(() => import("../app"));
// Модуль с SDK — только после загрузки приложения, иначе SDK поднимется раньше харнесса.
const { forgetShownFlowChoices } = await import("./flow-picker");

afterEach(cleanup);
afterEach(forgetShownFlowChoices);

/** Служебные иконки строки — галочка и кружок выбранного, стрелка раскрытия: они не значок flow. */
const CHROME = new Set(["Check", "Circle", "ChevronDown"]);
/** Значок flow внутри узла: имя иконки из подборки, а без неё — знак плагина `plain` или `crossed`; `null` — значка нет. */
const glyphOf = (node: Element): string | null => {
  const glyph = [...node.querySelectorAll("[data-icon], [data-flow-mark]")].find((el) => !CHROME.has(el.getAttribute("data-icon") ?? ""));
  return glyph === undefined ? null : (glyph.getAttribute("data-icon") ?? glyph.getAttribute("data-flow-mark"));
};

const pickerFlows = [
  { id: "quick", name: "Quick", icon: "Rocket" },
  { id: "plain", name: "Plain" },
];

const picker = (selected: string) =>
  renderSlot(app.composerCustomizations.find((c) => c.id === "flow")!.actions![0]!, {}, {
    rpc: { getFlowChoice: () => ({ flows: pickerFlows, selected }), setFlowChoice: ({ flowId }: { flowId: string }) => ({ selected: flowId }) } as never,
    composer: { scope: { kind: "new-thread", projectId: "proj_a" } },
    settings: { language: "Русский" },
  });

const choiceFlows = [
  { id: "quick", name: "Quick", stages: 3, icon: "Rocket" },
  { id: "plain", name: "Plain", stages: 2 },
];

const choiceRow = (selected: string) =>
  renderSlot(app.composerCustomizations.find((c) => c.id === "flow-progress")!.banners![0]!, {}, {
    rpc: { getFlowProgress: () => null, threadFlowChoice: () => ({ flows: choiceFlows, selected }) } as never,
    composer: { scope: { kind: "thread", threadId: "thr_1" } },
    settings: { language: "Русский" },
  });

describe("иконка flow в кнопке композера", () => {
  it("кнопка композера показывает иконку выбранного flow", async () => {
    const quick = picker("quick");
    expect(glyphOf(await quick.findByRole("button", { name: /Quick/ }))).toBe("Rocket");
    cleanup();
    forgetShownFlowChoices();
    const auto = picker("auto");
    expect(glyphOf(await auto.findByRole("button", { name: "Автоматически" }))).toBe("plain");
  });

  it("пункт flow в меню композера показывает его иконку, flow без иконки — знак плагина", async () => {
    const slot = picker("quick");
    const trigger = await slot.findByRole("button", { name: /Quick/ });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    const items = await screen.findAllByRole("menuitemradio");
    expect(items.map((item) => [item.textContent, glyphOf(item)])).toEqual([
      ["Автоматически", "plain"],
      ["Quick", "Rocket"],
      ["Plain", "plain"],
      ["Без flow", "crossed"],
    ]);
  });
});

describe("иконка flow в строке выбора над композером", () => {
  it("строка выбора flow показывает иконку выбранного flow и иконки вариантов", async () => {
    const slot = choiceRow("quick");
    const head = await screen.findByRole("button", { name: /Flow: Quick/ });
    expect(glyphOf(head)).toBe("Rocket");
    fireEvent.click(head);
    const options = [...slot.container.querySelectorAll("[data-flow-choice-option]")];
    expect(options.map((option) => [option.getAttribute("data-flow-choice-option"), glyphOf(option)])).toEqual([
      ["auto", "plain"],
      ["quick", "Rocket"],
      ["plain", "plain"],
      ["none", "crossed"],
    ]);
  });
});
