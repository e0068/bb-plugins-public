// @vitest-environment jsdom
import { cleanup, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import type { FlowSettings, flowSettingsRpcContract, StageCatalog, WorkStage } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const stage = (id: string, patch: Partial<WorkStage> = {}): WorkStage => ({ id, kind: "skill", skill: id, name: id, executors: [], ...patch });
const catalog: StageCatalog = { skills: [], executors: [] };

const open = (stages: WorkStage[]) => {
  const settings: FlowSettings = { flows: [{ id: "plugin", name: "BB Plugin", stages }], minButtonWidth: 170 };
  return renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: "" }, {
    rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => catalog, getRootSkill: () => null } as never,
    settings: { language: "Русский" },
  });
};

const LINKED = [stage("ship"), stage("preview", { parent: "demo" }), stage("demo"), stage("restore", { parent: "demo" }), stage("merge")];

describe("вид связки в таблице этапов", () => {
  it("у под-этапа нет ни номера, ни подписи «до» или «после»", async () => {
    const slot = open(LINKED);
    await slot.findByRole("row", { name: "Этап 5" });
    const leads = [1, 2, 3, 4, 5].map((n) => slot.getByRole("row", { name: `Этап ${n}` }).querySelector('[role="cell"]')!.textContent);
    expect(leads).toEqual(["1", "", "2", "", "3"]);
  });

  it("шапка таблицы без фона", async () => {
    const slot = open(LINKED);
    const header = (await slot.findByRole("columnheader", { name: "№" })).closest('[role="row"]') as HTMLElement;
    expect(header.className).not.toMatch(/\bbg-/);
  });

  it("у поля навыка одна кнопка — открыть файл навыка в bb", async () => {
    const slot = open(LINKED);
    const row = within(await slot.findByRole("row", { name: "Этап 1" }));
    expect(row.getByRole("button", { name: "Открыть навык ship" })).toBeTruthy();
    expect(row.queryByRole("button", { name: /в файловой системе/ })).toBeNull();
  });
});
