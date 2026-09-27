// @vitest-environment jsdom
// Справа в ячейке несделанного этапа шеврон раскрывает список исполнителей — и
// стоит только там, где выбирать есть из чего. У этапа без исполнителей, как у
// Демонстрации, справа пусто и раскрывать нечего. Подпись этапа тянется по
// ширине ячейки, занимает не больше двух строк и обрезается многоточием.
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { add, dev2, planner, report, stage, stagedBrief } from "../core/stages-fixtures";
import type { DecisionBrief, WorkStage, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const LONG = "Смёрджить PR, Задача → done, Pull Main → Origin, Архивировать тред";
const merge: WorkStage = { id: "merge", kind: "skill", skill: "", name: LONG, executors: [], automation: { source: "flow", steps: [] } };

const brief: DecisionBrief = stagedBrief(
  [
    report("task", { recommended: true, add: add(1, 2, 0, 5) }),
    report("implement", { recommended: true, add: add(10, 20, 2, 60) }),
    report("demo", { recommended: true, add: add(1, 2, 0, 5) }),
    report("merge", { recommended: true }),
  ],
  {
    stages: {
      list: [
        stage("task", { skill: "task-flow", name: "Задача" }),
        stage("implement", { name: "Реализация", executors: [planner, dev2] }),
        { id: "demo", kind: "demo", skill: "", name: "Demonstration", executors: [] },
        merge,
      ],
      minButtonWidth: 170,
    },
  },
);

const open = () =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer: null }), answerBrief: (() => ({ kind: "not_found" })) as never } },
  );

type Slot = ReturnType<typeof open>;

const cell = async (slot: Slot, id: string) => {
  await slot.findByRole("group", { name: "Ответ на бриф" });
  return slot.container.querySelector<HTMLElement>(`[data-stage="${id}"]`)!;
};

const expander = (el: HTMLElement) => el.querySelector<HTMLElement>("[aria-expanded]");

describe("шеврон исполнителя в ячейке этапа", () => {
  it("у этапа с исполнителями справа шеврон вниз, и он раскрывает список исполнителей", async () => {
    const slot = open();
    const implement = await cell(slot, "implement");
    const button = expander(implement)!;
    expect(button.querySelector('[data-icon="ChevronDown"]')).not.toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(slot.getByRole("group", { name: /Реализация/ })).toBeTruthy();
  });

  it("у этапов без исполнителей — навыка и Демонстрации — ни шеврона, ни раскрытия", async () => {
    const slot = open();
    for (const id of ["task", "demo"]) {
      const el = await cell(slot, id);
      expect(expander(el)).toBeNull();
      expect(el.querySelector('[data-icon="ChevronDown"]')).toBeNull();
      expect(el.querySelector('[data-icon="BookOpen"], [data-icon="Presentation"]')).toBeNull();
    }
  });
});

describe("подпись этапа в своей ячейке", () => {
  it("длинное название не больше двух строк с многоточием, целиком — в подсказке", async () => {
    const slot = open();
    const label = within(await cell(slot, "merge")).getByText(LONG);
    expect(label.className).toContain("line-clamp-2");
    expect(label.className).not.toContain("truncate");
    expect(label.getAttribute("title")).toBe(LONG);
  });
});
