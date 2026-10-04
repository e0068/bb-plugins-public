// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";
import { threadFiles } from "./file-roots-fixture";

const app = await loadPluginApp(() => import("../app"));
// Модуль с SDK — только после загрузки приложения, иначе SDK поднимется раньше харнесса.
const { forgetShownFlowChoices } = await import("./flow-picker");

afterEach(cleanup);
afterEach(forgetShownFlowChoices);

const flows = [
  { id: "flow-general", name: "General", stages: 7 },
  { id: "flow-plugin", name: "BB Plugin", stages: 11 },
];

/** Знак flow внутри узла: `crossed` — «без flow», `plain` — flow; `null` — знака нет. */
const markOf = (node: Element) => node.querySelector("[data-flow-mark]")?.getAttribute("data-flow-mark") ?? null;

const choiceRow = (selected: string) =>
  renderSlot(app.composerCustomizations.find((c) => c.id === "flow-progress")!.banners![0]!, {}, {
    rpc: { getFlowProgress: () => null, threadFlowChoice: () => ({ flows, selected }) } as never,
    composer: { scope: { kind: "thread", threadId: "thr_1" } },
    settings: { language: "Русский" },
  });

describe("знак flow из композера", () => {
  it("строка выбора без flow пишет «Без flow» с перечёркнутым знаком, а не молнией", async () => {
    const slot = choiceRow("none");
    const head = await screen.findByRole("button", { name: "Без flow" });
    expect(markOf(head)).toBe("crossed");
    expect(slot.container.querySelector('[data-icon="Zap"]')).toBeNull();
  });

  it("строка выбора с flow — обычный знак", async () => {
    choiceRow("flow-plugin");
    expect(markOf(await screen.findByRole("button", { name: /Flow: BB Plugin/ }))).toBe("plain");
  });

  it("в списке строки выбора у каждого flow обычный знак, у «Без flow» — перечёркнутый", async () => {
    const slot = choiceRow("none");
    fireEvent.click(await screen.findByRole("button", { name: "Без flow" }));
    const options = [...slot.container.querySelectorAll("[data-flow-choice-option]")];
    expect(options.map((o) => [o.textContent, markOf(o)])).toEqual([
      ["Автоматически", "plain"],
      ["General7 этапов", "plain"],
      ["BB Plugin11 этапов", "plain"],
      ["Без flow", "crossed"],
    ]);
  });

  it("в выпадашке композера у каждого flow обычный знак, у «Без flow» — перечёркнутый", async () => {
    const slot = renderSlot(app.composerCustomizations.find((c) => c.id === "flow")!.actions![0]!, {}, {
      rpc: { getFlowChoice: () => ({ flows: [{ id: "quick", name: "Quick" }], selected: "quick" }), setFlowChoice: () => ({ selected: "quick" }) } as never,
      composer: { scope: { kind: "new-thread", projectId: "proj_a" } },
      settings: { language: "Русский" },
    });
    const trigger = await slot.findByRole("button", { name: /Quick/ });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    const items = await screen.findAllByRole("menuitemradio");
    expect(items.map((item) => [item.textContent, markOf(item)])).toEqual([
      ["Автоматически", "plain"],
      ["Quick", "plain"],
      ["Без flow", "crossed"],
    ]);
  });

  it("в меню бара у «Отменить flow» перечёркнутый знак вместо крестика", async () => {
    const view = { current: "code", done: 0, total: 1, planned: null, flowName: "BB Plugin", environmentId: "env_1", stages: [{ id: "code", kind: "skill", name: "Реализация", executor: "self", state: "now", results: [], minutes: null, cost: null }] };
    renderSlot(app.composerCustomizations.find((c) => c.id === "flow-progress")!.banners![0]!, {}, {
      rpc: { getFlowProgress: () => view, threadFiles } as never,
      composer: { scope: { kind: "thread", threadId: "thr_1" } },
      settings: { language: "Русский" },
    });
    fireEvent.click(await screen.findByRole("button", { name: /Прогресс flow/ }));
    const menu = screen.getByRole("button", { name: "Меню flow" });
    fireEvent.pointerDown(menu, { button: 0, ctrlKey: false });
    fireEvent.click(menu);
    const cancel = await screen.findByRole("menuitem", { name: "Отменить flow" });
    expect(markOf(cancel)).toBe("crossed");
    expect(cancel.querySelector('[data-icon="X"]')).toBeNull();
  });
});
