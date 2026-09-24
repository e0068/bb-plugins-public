// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { add, planner, report, stagedBrief } from "../core/stages-fixtures";
import type { DecisionBrief, StageAnswer, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const fresh = stagedBrief([
  report("task", { recommended: true, add: add(1, 2, -1, 5) }),
  report("spec", { add: add(5, 9, -1, 20) }),
  report("plan", { recommended: true, add: add(4, 7, -1, 15), adds: { [planner.id]: add(2, 4, -1, 10) } }),
]);

const inReview = stagedBrief([
  report("task", { state: "done", results: [{ label: "BBPL-1", target: "docs/tasks/BBPL-1.md" }] }),
  report("spec", { state: "review", results: [{ label: "spec.md", target: "docs/specs/spec.md" }, { label: "prototype.html", target: "docs/assets/prototype.html" }] }),
  report("plan", { recommended: true }),
]);

const open = (brief: DecisionBrief, openWorkspaceFile: PluginMessageDirectiveProps["openWorkspaceFile"] = () => true) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer: null }), answerBrief: () => ({ kind: "not_found" }) } },
  );

type Slot = ReturnType<typeof open>;
const cell = async (slot: Slot, stageId: string) => {
  await slot.findByRole("group", { name: "Ответ на бриф" });
  return slot.container.querySelector<HTMLElement>(`[data-stage="${stageId}"]`)!;
};

describe("кнопки этапов", () => {
  it("минимальная ширина кнопки — из снимка настроек", async () => {
    const slot = open({ ...fresh, stages: { list: fresh.stages!.list, minButtonWidth: 230 } });
    expect((await cell(slot, "task")).style.minWidth).toContain("230px");
  });

  it("сделанный этап — ссылка результата и галочка, без чекбокса; клик по кнопке раскрывает все результаты", async () => {
    const opened = vi.fn(() => true);
    const slot = open(inReview, opened);
    const task = within(await cell(slot, "task"));
    expect(task.queryByRole("button", { name: /в ближайший прогон/ })).toBeNull();
    expect(task.getByLabelText("Этап сделан")).toBeTruthy();
    fireEvent.click(task.getByRole("button", { name: /BBPL-1/ }));
    expect(opened).toHaveBeenCalledWith("docs/tasks/BBPL-1.md");
    expect(slot.queryByRole("group", { name: "Задача: результаты" })).toBeNull();
    fireEvent.click(task.getByRole("button", { name: "Задача" }));
    expect(slot.getByRole("group", { name: "Задача: результаты" })).toBeTruthy();
  });

});
