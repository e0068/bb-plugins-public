// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { add, report, stage, stagedBrief } from "../core/stages-fixtures";
import type { DecisionBrief, WorkStage, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const builtin: WorkStage = { id: "ff", kind: "skill", skill: "", name: "FF to Main", executors: [], automation: { source: "flow", steps: [] } };
const external: WorkStage = { id: "merge", kind: "skill", skill: "", name: "Merge", executors: [], automation: { id: "a1", name: "Merge" } };

/** Бриф, в котором агент прислал автоматизациям цену: её не должно быть видно. */
const brief: DecisionBrief = stagedBrief(
  [report("task", { recommended: true, add: add(1, 2, 0, 5) }), report("ff", { recommended: true, add: add(0.4, 0.8, 1, 2) }), report("merge", { recommended: true, add: add(0.4, 0.8, 1, 2) })],
  { stages: { list: [stage("task", { skill: "task-flow", name: "Задача" }), builtin, external], minButtonWidth: 170 } },
);

const open = (value: DecisionBrief) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: value.id }, source: `::decision{id="${value.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief: value, answer: null }), answerBrief: (() => ({ kind: "not_found" })) as never } },
  );

type Slot = ReturnType<typeof open>;

const cell = async (slot: Slot, stageId: string) => {
  await slot.findByRole("group", { name: "Ответ на бриф" });
  return slot.container.querySelector<HTMLElement>(`[data-stage="${stageId}"]`)!;
};

describe("этап-автоматизация в брифе", () => {
  it("показан без цены и без исполнителя", async () => {
    const slot = open(brief);
    const ff = within(await cell(slot, "ff"));
    expect(ff.getByText("FF to Main")).toBeTruthy();
    expect(ff.queryByText("Сам")).toBeNull();
    expect(ff.queryByText(/\$/)).toBeNull();
    expect(ff.queryByText(/мин/)).toBeNull();
    expect(ff.queryByText(/r$/)).toBeNull();
  });

  it("вместо шеврона — значок автоматизации, и нажать на него нельзя", async () => {
    const slot = open(brief);
    const ff = await cell(slot, "ff");
    const merge = await cell(slot, "merge");
    expect(ff.querySelector('[data-icon="ChevronDown"]')).toBeNull();
    expect(ff.querySelector('[data-icon="Zap"]')).toBeTruthy();
    expect(merge.querySelector('[data-icon="Workflow"]')).toBeTruthy();
    expect(within(ff).queryByRole("button", { expanded: false })).toBeNull();
    expect(ff.querySelectorAll("button").length).toBe(1);
  });

  it("галочка «в прогон» работает как у остальных этапов", async () => {
    const slot = open(brief);
    const ff = within(await cell(slot, "ff"));
    const check = ff.getByRole("button", { name: "FF to Main: в ближайший прогон" });
    expect(check.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(check);
    expect(check.getAttribute("aria-pressed")).toBe("false");
  });

  it("сделанная автоматизация показывает ссылки результатов и раскрывается, как прежде", async () => {
    const done = stagedBrief([report("ff", { state: "done", results: [{ label: "PR #12", target: "https://example.test/pr/12" }, { label: "main", target: "https://example.test/main" }] })], {
      stages: { list: [builtin], minButtonWidth: 170 },
    });
    const slot = open(done);
    const ff = within(await cell(slot, "ff"));
    expect(ff.getByText("PR #12")).toBeTruthy();
    expect(ff.getByText("+1")).toBeTruthy();
    fireEvent.click(ff.getByRole("button", { name: "FF to Main" }));
    expect(await slot.findByRole("group", { name: "FF to Main: результаты" })).toBeTruthy();
  });

  it("цена автоматизации не попадает в кнопку «Бюджет»", async () => {
    const slot = open(brief);
    await cell(slot, "ff");
    const budget = slot.getByRole("button", { name: /Бюджет/ });
    expect(budget.textContent).toContain("$1");
    expect(budget.textContent).toContain("5 мин");
  });
});
