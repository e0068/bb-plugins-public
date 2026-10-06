// @vitest-environment jsdom
// Этап «Flow» строками, как этап с под-этапами: имя вложенного flow текстом в первой строке, под ним по строке
// на каждый его этап с чипами только для чтения — без крестиков и без плюсов.
import { cleanup, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import type { Flow, FlowSettings, flowSettingsRpcContract, StageCatalog, WorkStage } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const stage = (id: string, patch: Partial<WorkStage> = {}): WorkStage => ({ id, kind: "skill", skill: id, name: id, executors: [], ...patch });
const ref = (id: string, flowId: string, name = "Ответ"): WorkStage => ({ id, kind: "skill", skill: "", name, executors: [], flowId });
const flow = (id: string, name: string, stages: WorkStage[]): Flow => ({ id, name, stages });
const catalog: StageCatalog = { skills: [], executors: [] };

const reviewer = { kind: "agent" as const, id: "agent:code-reviewer", name: "code-reviewer", model: "opus" };
const ANSWER = flow("answer", "Answer", [
  stage("project", { executors: [reviewer] }),
  stage("land", { skill: "", automation: { source: "flow", steps: ["git.commit", "git.merge"] } }),
  stage("demo"),
]);
const PLUGIN = (stages: WorkStage[]) => flow("plugin", "BB Plugin", stages);

const open = (flows: Flow[]) => {
  const settings: FlowSettings = { flows, minButtonWidth: 170 };
  return renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: "plugin" }, {
    rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => catalog, getRootSkill: () => null } as never,
    settings: { language: "Русский" },
  });
};

type Slot = ReturnType<typeof open>;

/** Строки таблицы без строки заголовков. */
const bodyRows = async (slot: Slot) => {
  await slot.findByRole("row", { name: "Этап 1" });
  return slot.getAllByRole("row").slice(1);
};

describe("этап «Flow» строками вложенного flow", () => {
  it("этап-flow занимает по строке на каждый этап вложенного flow", async () => {
    const slot = open([PLUGIN([ref("nested", "answer")]), ANSWER]);
    expect(await bodyRows(slot)).toHaveLength(3);
  });

  it("первая строка подписана именем вложенного flow текстом, а не полем ввода", async () => {
    const slot = open([PLUGIN([ref("nested", "answer")]), ANSWER]);
    const first = within(await slot.findByRole("row", { name: "Этап 1" }));
    expect(first.getByText("Answer")).toBeTruthy();
    expect(first.queryByRole("textbox")).toBeNull();
  });

  it("имя в первой строке следует за переименованием вложенного flow", async () => {
    const slot = open([PLUGIN([ref("nested", "answer")]), { ...ANSWER, name: "Ответ v2" }]);
    expect(within(await slot.findByRole("row", { name: "Этап 1" })).getByText("Ответ v2")).toBeTruthy();
  });

  it("строки показывают чипы этапов вложенного flow: навык, исполнителей и шаги", async () => {
    const slot = open([PLUGIN([ref("nested", "answer")]), ANSWER]);
    const [first, second, third] = (await bodyRows(slot)).map((row) => within(row));
    expect(first!.getByText("Навык: project")).toBeTruthy();
    expect(first!.getByText("code-reviewer")).toBeTruthy();
    expect(second!.getByText("Commit")).toBeTruthy();
    expect(third!.getByText("Навык: demo")).toBeTruthy();
  });

  it("на чипах нет крестиков, в строках нет плюсов и замены flow", async () => {
    const slot = open([PLUGIN([ref("nested", "answer")]), ANSWER]);
    for (const row of (await bodyRows(slot)).map((r) => within(r))) {
      expect(row.queryByRole("button", { name: /^Убрать/ })).toBeNull();
      expect(row.queryByRole("button", { name: "Исполнение этапа" })).toBeNull();
      expect(row.queryByRole("button", { name: "Заменить flow" })).toBeNull();
    }
  });

  it("крест удаления этапа — только у первой строки", async () => {
    const slot = open([PLUGIN([ref("nested", "answer")]), ANSWER]);
    const crosses = (await bodyRows(slot)).map((row) => within(row).queryAllByRole("button", { name: /^Удалить этап/ }).length);
    expect(crosses).toEqual([1, 0, 0]);
  });

  it("обычный этап рядом с этапом-flow остаётся своей строкой с полем названия", async () => {
    const slot = open([PLUGIN([stage("task"), ref("nested", "answer")]), ANSWER]);
    expect(await bodyRows(slot)).toHaveLength(4);
    expect(within(await slot.findByRole("row", { name: "Этап 1" })).getByRole("textbox", { name: "Название этапа 1" })).toBeTruthy();
  });
});
