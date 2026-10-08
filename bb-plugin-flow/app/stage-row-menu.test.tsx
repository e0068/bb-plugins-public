// @vitest-environment jsdom
// «⋯» в строке этапа верхнего уровня: «Сохранить этап шаблоном» и «Преобразовать во Flow» — пунктами меню вместо закладки.
// Что меню стоит только у этапов верхнего уровня и не у строки «Flow» — в stage-settings-stage-templates-link и stage-settings-flow-stage.
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { openRowMenu } from "./row-menu-fixture";
import type { FlowSettings, flowSettingsRpcContract, StageTemplate, WorkStage } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const stage = (id: string, patch: Partial<WorkStage> = {}): WorkStage => ({ id, kind: "skill", skill: id, name: id, executors: [], ...patch });
const chain = (id: string, steps: string[]): WorkStage => stage(id, { skill: "", automation: { source: "flow", steps: steps as never } });
const LINKED = [stage("ship"), stage("preview", { parent: "demo" }), stage("demo", { name: "Демо" }), stage("restore", { parent: "demo" }), stage("nested", { skill: "", name: "Answer", flowId: "answer" })];
const ANSWER = { id: "answer", name: "Answer", stages: [stage("project")] };

const open = (stages: WorkStage[], stageTemplates?: StageTemplate[]) => {
  const settings: FlowSettings = { flows: [{ id: "plugin", name: "BB Plugin", stages }, ANSWER], minButtonWidth: 170, ...(stageTemplates === undefined ? {} : { stageTemplates }) };
  return renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: "plugin" }, {
    rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => ({ skills: [], executors: [] }), getRootSkill: () => null } as never,
    settings: { language: "Русский" },
  });
};
type Slot = ReturnType<typeof open>;
const lastSaved = (slot: Slot) => [...slot.rpcCalls].reverse().find((c) => c.method === "saveFlowSettings")?.input as FlowSettings | undefined;
const menuOf = async (slot: Slot, n: number) => openRowMenu(await slot.findByRole("row", { name: `Этап ${n}` }));

describe("меню «⋯» в строке этапа", () => {
  it("закладки в строке больше нет: шаблон сохраняет пункт меню", async () => {
    const slot = open(LINKED);
    await slot.findByRole("row", { name: "Этап 5" });
    expect(slot.queryByRole("button", { name: "Сохранить этап шаблоном" })).toBeNull();
    expect((await menuOf(slot, 1)).getByRole("menuitem", { name: "Сохранить этап шаблоном" })).toBeTruthy();
  });

  it("у сохранённого этапа под пунктом видно, почему он недоступен", async () => {
    const slot = open(LINKED, [{ kind: "skill", skill: "ship", name: "ship", executors: [] }]);
    expect((await menuOf(slot, 1)).getByText("Этап уже сохранён — он в меню «Добавить этап»")).toBeTruthy();
  });

  it("«Преобразовать во Flow» уносит этап с под-этапами в новый flow с его именем, на месте этапа — строка «Flow»", async () => {
    const slot = open(LINKED);
    fireEvent.click((await menuOf(slot, 3)).getByRole("menuitem", { name: "Преобразовать во Flow" }));
    await vi.waitFor(() => {
      const flows = lastSaved(slot)?.flows ?? [];
      const made = flows[2];
      expect(made?.name).toBe("Демо");
      expect(made?.stages.map((s) => s.id)).toEqual(["preview", "demo", "restore"]);
      expect(flows[0]?.stages.map((s) => s.flowId ?? s.id)).toEqual(["ship", made?.id, "answer"]);
    });
    expect(await within(slot.getByRole("navigation", { name: "Flow" })).findByRole("button", { name: /Демо/ })).toBeTruthy();
  });

  it("этап с мёрджем, чей PR открывает этап выше, не преобразуется: пункт недоступен, причина видна, коллекция прежняя", async () => {
    const slot = open([chain("open", ["git.create-pr"]), chain("merge", ["git.merge"])]);
    const menu = await menuOf(slot, 2);
    const item = menu.getByRole("menuitem", { name: "Преобразовать во Flow" });
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(menu.getByText("Этапу нужен PR, который открывает этап выше, — отдельным flow он не заработает")).toBeTruthy();
    fireEvent.click(item);
    expect(lastSaved(slot)).toBeUndefined();
  });
});
