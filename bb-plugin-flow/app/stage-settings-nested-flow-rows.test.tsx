// @vitest-environment jsdom
// Этап «Flow» строками, как этап с под-этапами: в первой строке только имя вложенного flow текстом, под ней по полной строке
// на каждый его этап — название текстом и чипы только для чтения, без крестиков и без плюсов.
import { cleanup, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
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
  it("первая строка — только имя вложенного flow, под ней по строке на каждый его этап", async () => {
    const slot = open([PLUGIN([ref("nested", "answer")]), ANSWER]);
    expect(await bodyRows(slot)).toHaveLength(4);
  });

  it("первая строка подписана именем вложенного flow текстом, а не полем ввода, и чипов в ней нет", async () => {
    const slot = open([PLUGIN([ref("nested", "answer")]), ANSWER]);
    const first = within(await slot.findByRole("row", { name: "Этап 1" }));
    expect(first.getByText("Answer")).toBeTruthy();
    expect(first.queryByRole("textbox")).toBeNull();
    expect(first.queryByText(/^Навык:/)).toBeNull();
    expect(first.queryByText("code-reviewer")).toBeNull();
  });

  it("имя в первой строке следует за переименованием вложенного flow", async () => {
    const slot = open([PLUGIN([ref("nested", "answer")]), { ...ANSWER, name: "Ответ v2" }]);
    expect(within(await slot.findByRole("row", { name: "Этап 1" })).getByText("Ответ v2")).toBeTruthy();
  });

  it("у каждого этапа вложенного flow — своё название текстом, без поля ввода", async () => {
    const named = flow("answer", "Answer", [stage("project", { name: "Проект" }), builtinStage("questions", []), stage("land", { name: "Посадка", skill: "", automation: { source: "flow", steps: ["git.commit"] } })]);
    const slot = open([PLUGIN([ref("nested", "answer")]), named]);
    const [, ...inner] = (await bodyRows(slot)).map((row) => within(row));
    expect(inner.map((row) => row.queryByRole("textbox"))).toEqual([null, null, null]);
    expect(inner[0]!.getByText("Проект")).toBeTruthy();
    expect(inner[1]!.getByText("Вопросы")).toBeTruthy();
    expect(inner[2]!.getByText("Посадка")).toBeTruthy();
  });

  it("строки этапов показывают их чипы: навык, исполнителей и шаги", async () => {
    const slot = open([PLUGIN([ref("nested", "answer")]), ANSWER]);
    const [, project, land, demo] = (await bodyRows(slot)).map((row) => within(row));
    expect(project!.getByText("Навык: project")).toBeTruthy();
    expect(project!.getByText("code-reviewer")).toBeTruthy();
    expect(land!.getByText("Commit")).toBeTruthy();
    expect(demo!.getByText("Навык: demo")).toBeTruthy();
  });

  it("виджет вложенного flow показывает тег своего навыка", async () => {
    const slot = open([PLUGIN([ref("nested", "answer")]), flow("answer", "Answer", [builtinStage("questions", [])])]);
    const [, questions] = (await bodyRows(slot)).map((row) => within(row));
    expect(questions!.getByText("Навык: flow-questions")).toBeTruthy();
  });

  it("на чипах нет крестиков, в строках нет плюсов и замены flow", async () => {
    const slot = open([PLUGIN([ref("nested", "answer")]), ANSWER]);
    for (const row of (await bodyRows(slot)).map((r) => within(r))) {
      expect(row.queryByRole("button", { name: /^Убрать/ })).toBeNull();
      expect(row.queryByRole("button", { name: "Исполнение этапа" })).toBeNull();
      expect(row.queryByRole("button", { name: "Заменить flow" })).toBeNull();
    }
  });

  it("крест удаления этапа — только у строки с именем flow", async () => {
    const slot = open([PLUGIN([ref("nested", "answer")]), ANSWER]);
    const crosses = (await bodyRows(slot)).map((row) => within(row).queryAllByRole("button", { name: /^Удалить этап/ }).length);
    expect(crosses).toEqual([1, 0, 0, 0]);
  });

  it("обычный этап рядом с этапом-flow остаётся своей строкой с полем названия", async () => {
    const slot = open([PLUGIN([stage("task"), ref("nested", "answer")]), ANSWER]);
    expect(await bodyRows(slot)).toHaveLength(5);
    expect(within(await slot.findByRole("row", { name: "Этап 1" })).getByRole("textbox", { name: "Название этапа 1" })).toBeTruthy();
  });
});
