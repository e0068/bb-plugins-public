// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { openRowMenu } from "./row-menu-fixture";
import type { FlowSettings, flowSettingsRpcContract, StageCatalog, StageTemplate, WorkStage } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const stage = (id: string, patch: Partial<WorkStage> = {}): WorkStage => ({ id, kind: "skill", skill: id, name: id, executors: [], ...patch });
const catalog: StageCatalog = { skills: [], executors: [] };
const LINKED = [stage("ship"), stage("preview", { parent: "demo" }), stage("demo"), stage("restore", { parent: "demo" }), stage("merge"), stage("done")];

const open = (stages: WorkStage[], stageTemplates?: StageTemplate[]) => {
  const settings: FlowSettings = { flows: [{ id: "plugin", name: "BB Plugin", stages }], minButtonWidth: 170, ...(stageTemplates === undefined ? {} : { stageTemplates }) };
  return renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: "" }, {
    rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => catalog, getRootSkill: () => null } as never,
    settings: { language: "Русский" },
  });
};
type Slot = ReturnType<typeof open>;
const lastSaved = (slot: Slot) => [...slot.rpcCalls].reverse().find((c) => c.method === "saveFlowSettings")?.input as FlowSettings | undefined;
const row = (slot: Slot, n: number) => slot.getByRole("row", { name: `Этап ${n}` });
const MENU = { name: /^Действия с этапом/ };
const SAVE = { name: "Сохранить этап шаблоном" };


describe("отступы между этапами в таблице", () => {
  it("каждый этап верхнего уровня отходит от строки выше на 4 px, под-этапы стоят вплотную к владельцу", async () => {
    const slot = open(LINKED);
    await slot.findByRole("row", { name: "Этап 6" });
    const apart = [1, 2, 3, 4, 5, 6].map((n) => row(slot, n).className.split(" ").includes("mt-[3px]"));
    expect(apart).toEqual([false, true, false, false, true, true]);
  });
});

describe("шаблон этапа с под-этапами", () => {
  it("меню «⋯» есть только у строк этапов верхнего уровня", async () => {
    const slot = open(LINKED);
    await slot.findByRole("row", { name: "Этап 6" });
    const has = [1, 2, 3, 4, 5, 6].map((n) => within(row(slot, n)).queryByRole("button", MENU) !== null);
    expect(has).toEqual([true, false, true, false, true, true]);
  });

  it("«Сохранить этап шаблоном» у главного этапа сохраняет его целиком с под-этапами до и после", async () => {
    const slot = open(LINKED);
    fireEvent.click((await openRowMenu(await slot.findByRole("row", { name: "Этап 3" }))).getByRole("menuitem", SAVE));
    await vi.waitFor(() =>
      expect(lastSaved(slot)?.stageTemplates).toEqual([
        { kind: "skill", skill: "demo", name: "demo", executors: [], subStages: [{ kind: "skill", skill: "preview", name: "preview", executors: [], before: true }, { kind: "skill", skill: "restore", name: "restore", executors: [] }] },
      ]),
    );
  });

  it("«Добавить этап» из такого шаблона ставит в конец всю связку", async () => {
    const template: StageTemplate = { kind: "skill", skill: "demo", name: "Демо", executors: [], subStages: [{ kind: "skill", skill: "preview", name: "Превью", executors: [], before: true }, { kind: "skill", skill: "restore", name: "Откат", executors: [] }] };
    const slot = open([stage("ship")], [template]);
    fireEvent.click(await slot.findByRole("button", { name: "Добавить этап" }));
    fireEvent.click(slot.getByRole("menuitem", { name: "Демо" }));
    await vi.waitFor(() => {
      const stages = lastSaved(slot)?.flows[0]?.stages ?? [];
      expect(stages.map((s) => s.name)).toEqual(["ship", "Превью", "Демо", "Откат"]);
      const owner = stages[2]!.id;
      expect(stages.map((s) => s.parent)).toEqual([undefined, owner, undefined, owner]);
    });
  });
});
