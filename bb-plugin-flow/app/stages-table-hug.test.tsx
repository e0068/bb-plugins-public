// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { add, report, stage, stagedBrief } from "../core/stages-fixtures";
import type { WorkStage, decisionsRpcContract } from "../shared/contract";
import { threadFiles } from "./file-roots-fixture";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const CRITERIA: WorkStage = { id: "criteria", kind: "criteria", skill: "", name: "Criteria", executors: [] };

const brief = stagedBrief([report("criteria", { recommended: true }), report("task", { recommended: true })], {
  stages: { list: [CRITERIA, stage("task", { skill: "task-flow", name: "Задача", executors: [{ id: "agent:implementer", kind: "agent", name: "Имплементер", model: "sonnet" }] })], minButtonWidth: 170 },
  setup: { stages: [report("criteria", { recommended: true }), report("task", { recommended: true })], criteria: [{ text: "Чекбоксы в таблице этапов", add: add(1, 2, 1, 8) }] },
});

const open = () =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer: null }), answerBrief: () => ({ kind: "not_found" }), ...({ threadFiles } as object) } },
  );

// Раскладку jsdom не считает: тест держит само обещание — числовые колонки по содержимому, а не фиксированной ширины, и строки берут их подсеткой.
describe("колонки Risk, Time, Target и Ceiling по ширине содержимого", () => {
  it("широкая сетка таблицы даёт числовым колонкам auto, а не фиксированные ширины", async () => {
    const group = await open().findByRole("group", { name: "Этапы и бюджет" });
    expect(group.className).toContain("grid-cols-[38px_minmax(0,1fr)_auto_auto_auto_10px_auto_40px]");
    expect(group.className).not.toContain("4.75rem");
  });

  it("строки берут колонки сетки подсеткой, чтобы числа разных строк стояли в одном столбце", async () => {
    const group = await open().findByRole("group", { name: "Этапы и бюджет" });
    expect(group.querySelector<HTMLElement>("[data-criterion]")!.className).toContain("[grid-template-columns:subgrid]");
  });

  it("у раскрытых исполнителей подсетка идёт по всей цепочке: блок, обёртка строки, сама строка", async () => {
    const slot = open();
    const table = await slot.findByRole("group", { name: "Этапы и бюджет" });
    fireEvent.click(within(table.querySelector<HTMLElement>('[data-stage="task"]')!).getByRole("button", { name: "Задача: исполнитель" }));
    const executors = within(table).getByRole("group", { name: "Задача: исполнитель" });
    const button = within(executors).getAllByRole("button")[0]!;
    for (const level of [executors, button.parentElement!, button]) expect(level.className).toContain("[grid-template-columns:subgrid]");
  });
});
