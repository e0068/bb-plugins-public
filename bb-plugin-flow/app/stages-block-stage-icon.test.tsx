// @vitest-environment jsdom
// Справа в ячейке этапа стоял шеврон, раскрывающий список исполнителей, — а
// список этот почти всегда из одного пункта «Сам». На месте шеврона теперь
// значок самого этапа, как уже сделано у автоматизации, и он не подсвечивается.
import { cleanup, fireEvent } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { add, report, stage, stagedBrief } from "../core/stages-fixtures";
import { KIND_ICONS, SKILL_ICON } from "./stage-icons";
import type { DecisionBrief, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const brief: DecisionBrief = stagedBrief(
  [report("task", { recommended: true, add: add(1, 2, 0, 5) }), report("demo", { recommended: true, add: add(1, 2, 0, 5) })],
  { stages: { list: [stage("task", { skill: "task-flow", name: "Задача" }), { id: "demo", kind: "demo", skill: "", name: "Demonstration", executors: [] }], minButtonWidth: 170 } },
);

const open = () =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer: null }), answerBrief: (() => ({ kind: "not_found" })) as never } },
  );

const cell = async (slot: ReturnType<typeof open>, id: string) => {
  await slot.findByRole("group", { name: "Ответ на бриф" });
  return slot.container.querySelector<HTMLElement>(`[data-stage="${id}"]`)!;
};

/** Кнопка справа в ячейке этапа: её подпись — само название этапа, у чекбокса слева подпись другая. */
const tail = async (slot: ReturnType<typeof open>, name: string) => (await slot.findAllByRole("button", { name })).at(-1)!;

describe("значок этапа на месте шеврона", () => {
  it("у этапа навыка — книга, у встроенного — знак его вида", async () => {
    const slot = open();
    expect((await cell(slot, "task")).querySelector(`[data-icon="${SKILL_ICON}"]`)).not.toBeNull();
    expect((await cell(slot, "demo")).querySelector(`[data-icon="${KIND_ICONS.demo}"]`)).not.toBeNull();
    expect((await cell(slot, "task")).querySelector('[data-icon="ChevronDown"]')).toBeNull();
  });

  it("под наведением значок не подсвечивается", async () => {
    const slot = open();
    expect((await tail(slot, "Задача")).className).not.toContain("hover:bg-state-hover");
  });

  it("нажатие по-прежнему раскрывает список исполнителей", async () => {
    const slot = open();
    const button = await tail(slot, "Задача");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });
});
