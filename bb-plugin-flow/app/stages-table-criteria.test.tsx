// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { add, report, stage, stagedBrief } from "../core/stages-fixtures";
import type { DecisionBrief, WorkStage, decisionsRpcContract } from "../shared/contract";
import { threadFiles } from "./file-roots-fixture";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const CRITERIA: WorkStage = { id: "criteria", kind: "criteria", skill: "", name: "Criteria", executors: [] };
const LIST: WorkStage[] = [CRITERIA, stage("task", { skill: "task-flow", name: "Задача" })];

/** Бриф без этапа самой работы: цены пунктов — отдельные строки прогноза. */
const brief = stagedBrief([report("criteria", { recommended: true }), report("task", { recommended: true })], {
  stages: { list: LIST, minButtonWidth: 170 },
  setup: {
    stages: [report("criteria", { recommended: true }), report("task", { recommended: true })],
    criteria: [
      { text: "Чекбоксы в таблице этапов", add: add(1, 2, 1, 8) },
      { text: "Строка «Итого» в одну линию", add: add(3, 4, 0, 5) },
    ],
  },
});

const open = (b: DecisionBrief) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: b.id }, source: `::decision{id="${b.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief: b, answer: null }), answerBrief: () => ({ kind: "not_found" }), ...({ threadFiles } as object) } },
  );

type Slot = ReturnType<typeof open>;

const table = async (slot: Slot) => slot.findByRole("group", { name: "Этапы и бюджет" });
const criterionRow = (root: HTMLElement, index: number) => root.querySelector<HTMLElement>(`[data-criterion="${index}"]`)!;

describe("пункты «Готово, когда» в таблице этапов", () => {
  it("время и деньги пункта стоят числом без плюса, риск — со знаком, а экономия — с минусом", async () => {
    const root = await table(open(brief));
    const text = criterionRow(root, 0).textContent!;
    expect(text).toContain("8 мин");
    expect(text).toContain("+1r");
    expect(text).not.toMatch(/\+\$|\+\d+ мин/);
    const saving = await table(open({ ...brief, setup: { ...brief.setup, criteria: [{ text: "Экономия", add: add(-2, -1, 0, -20) }] } }));
    expect(criterionRow(saving, 0).textContent).toContain("–20 мин");
    expect(criterionRow(saving, 0).textContent).toContain("–$1");
  });

  it("стоят сразу под строкой «Критерии», названы своим текстом, с ценой в колонках", async () => {
    const root = await table(open(brief));
    const criteria = root.querySelector<HTMLElement>('[data-stage="criteria"]')!;
    expect(criteria.nextElementSibling).toBe(criterionRow(root, 0));
    expect(criterionRow(root, 0).nextElementSibling).toBe(criterionRow(root, 1));
    expect(criterionRow(root, 0).textContent).toContain("Чекбоксы в таблице этапов");
    expect(criterionRow(root, 0).textContent).toContain("$1");
    expect(root.textContent).not.toContain("Пункт 1");
  });

  it("чекбокс пункта снимает его, как крестик в критериях: строка зачёркнута, без чисел, и в ответ уходит снятым", async () => {
    const slot = open(brief);
    const root = await table(slot);
    const box = within(criterionRow(root, 0)).getByRole("checkbox", { name: "Пункт 1" });
    expect(box.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(box);
    expect(within(criterionRow(root, 0)).getByRole("checkbox", { name: "Пункт 1" }).getAttribute("aria-checked")).toBe("false");
    expect(criterionRow(root, 0).textContent).not.toContain("$");
    expect(criterionRow(root, 0).querySelector(".line-through")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Отправить бриф" }));
    await vi.waitFor(() => expect(slot.rpcCalls.some((c) => c.method === "answerBrief")).toBe(true));
    const sent = slot.rpcCalls.find((c) => c.method === "answerBrief")?.input as { answer: { criteria?: { removed: number[] } } };
    expect(sent.answer.criteria?.removed).toEqual([0]);
  });
});

describe("строка Definition of Done сворачивает свои пункты", () => {
  it("нажатие прячет пункты и показывает их снова", async () => {
    const slot = open(brief);
    const root = await table(slot);
    const fold = within(root.querySelector<HTMLElement>('[data-stage="criteria"]')!).getByRole("button", { name: "Definition of Done" });
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(fold);
    expect(root.querySelector("[data-criterion]")).toBeNull();
    fireEvent.click(fold);
    expect(criterionRow(root, 0)).toBeTruthy();
  });

  it("у брифа с этапом самой работы пункт всё равно несёт свою цену", async () => {
    const work = stage("work", { skill: "code-standards-fp", name: "Работа" });
    const withWork = stagedBrief([], {
      stages: { list: [CRITERIA, work], minButtonWidth: 170 },
      setup: {
        stages: [report("criteria", { recommended: true }), report("work", { recommended: true, share: { percent: 100, risk: 1 } })],
        criteria: [{ text: "Чекбоксы в таблице этапов", add: add(1, 2, 1, 8) }],
      },
    });
    const row = criterionRow(await table(open(withWork)), 0);
    expect(row.textContent).toContain("$1");
    expect(row.textContent).toContain("8 мин");
  });
});
