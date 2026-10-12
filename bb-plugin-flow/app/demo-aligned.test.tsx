// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionBrief, decisionsRpcContract, dispatchRpcContract, outcomeRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const demo: DecisionBrief = {
  id: "dec_aligned",
  threadId: "thr_1",
  title: "Демонстрация починки",
  createdAt: "2026-09-17T10:00:00.000Z",
  kind: "brief",
  launched: true,
  questions: [],
  outcome: {
    stage: "demo",
    final: false,
    next: "Ревью",
    done: ["Баг починен"],
    pending: [],
    results: [
      { label: "страница", target: "http://localhost:5173/" },
      { label: "Приложение", command: "open -a Calculator" },
    ],
  },
  stages: { list: [{ ...builtinStage("demo", []), name: "Демонстрация" }], minButtonWidth: 160 },
};

/** Утверждение — тот же итог на этапе, который держит работу: у него «Исполнять» в ряду кнопок. */
const approval: DecisionBrief = { ...demo, outcome: { ...demo.outcome!, stage: "approve" }, stages: { list: [builtinStage("approve", [])], minButtonWidth: 160 } };

const open = (brief: DecisionBrief = demo) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract & typeof dispatchRpcContract & typeof outcomeRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer: null }), answerBrief: () => ({ kind: "not_found" }), getDispatchPlace: () => ({ place: "thread" }), listProjects: () => ({ kind: "found" as const, projects: [] }), runOutcomeCommand: () => ({ kind: "sent", created: false }) } },
  );

const classes = (element: Element, prefix: RegExp) => element.className.split(" ").filter((c) => prefix.test(c));

describe("кнопки Утверждения с комментарием выровнены", () => {
  it("«Исполнять» и «Отправить комментарии» — одной ширины в ряду, раскрытые списки «Исполнять» — колонками с тем же зазором", async () => {
    const slot = open(approval);
    fireEvent.change(await slot.findByRole("textbox", { name: "Комментарий к демонстрации" }), { target: { value: "Поправь" } });
    const place = slot.getByRole("button", { name: /^Исполнять/ });
    const row = slot.getByRole("button", { name: "Отправить комментарии" }).parentElement!;
    expect(row.className).toContain("flex-wrap");
    expect([...row.children]).toHaveLength(2);
    expect(row.contains(place)).toBe(true);
    expect(slot.getByRole("group", { name: "Утверждение" }).contains(row)).toBe(false);
    fireEvent.click(place);
    const lists = slot.getByRole("group", { name: "Тред" }).parentElement!;
    expect(classes(lists, /^gap-/)).toEqual(classes(row, /^gap-/));
  });
});

describe("заголовки разделов Демонстрации", () => {
  it("пишутся как есть, без капса", async () => {
    const slot = open();
    const card = within(await slot.findByRole("group", { name: "Демонстрация" }));
    for (const title of ["Сделано", "Результаты"]) expect(card.getByText(title).className).not.toMatch(/\buppercase\b/);
  });
});

describe("раскрытые списки «Исполнять» у Утверждения", () => {
  it("каждая колонка — своя скруглённая группа, все в одном ряду с зазором", async () => {
    const slot = open(approval);
    fireEvent.click(await slot.findByRole("button", { name: /^Исполнять/ }));
    const row = slot.getByRole("group", { name: "Тред" }).parentElement!;
    for (const name of ["Тред", "Рабочее дерево", "Ветка"]) {
      const column = slot.getByRole("group", { name });
      expect(column.parentElement).toBe(row);
      expect(column.className).toMatch(/\brounded-lg\b/);
      expect(column.className).toMatch(/\boverflow-hidden\b/);
    }
    expect(row.className).toMatch(/\bgap-2\b/);
  });
});
