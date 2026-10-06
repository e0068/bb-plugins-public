// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { add, report, stage, stagedBrief } from "../core/stages-fixtures";
import type { AnswerRecord, DecisionBrief, WorkStage, decisionsRpcContract } from "../shared/contract";
import { threadFiles } from "./file-roots-fixture";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const CRITERIA: WorkStage = { id: "criteria", kind: "criteria", skill: "", name: "Criteria", executors: [] };

/** Бриф со скриншота: простой ответ стоит 0 и лежит в пункте брифа, богатый снимает его и приносит свой пункт. */
const brief: DecisionBrief = stagedBrief([report("criteria", { recommended: true }), report("work", { recommended: true, share: { percent: 100, risk: 1 } })], {
  stages: { list: [CRITERIA, stage("work", { skill: "code-standards-fp", name: "Работа" })], minButtonWidth: 170 },
  setup: {
    stages: [report("criteria", { recommended: true }), report("work", { recommended: true, share: { percent: 100, risk: 1 } })],
    criteria: [
      { text: "Одна команда кладёт PNG каждого фрейма в папку файла", add: add(0.4, 0.8, 1, 10) },
      { text: "Токен читается только из окружения", add: add(0.1, 0.2, 1, 3) },
    ],
  },
  questions: [
    {
      id: "what",
      question: "Что выкачивать?",
      kind: "fork",
      allowOwn: false,
      options: [
        { id: "images", action: "Картинки фреймов", description: "…", recommended: true, add: add(0, 0, 0, 0) },
        { id: "json", action: "Картинки и JSON", description: "…", recommended: false, add: add(0.15, 0.3, 0, 4), criteria: ["Рядом с PNG лежит JSON дерева слоёв"] },
        { id: "fig", action: ".fig-файлы целиком", description: "…", recommended: false, add: add(3, 6, 4, 60), criteria: ["Скрипт скачивает .fig каждого файла через браузер"], removes: [0] },
      ],
    },
  ],
});

/** Бриф, где отказ от рекомендации тоже несёт свой пункт: по нему видно, зачёркнут он или убран. */
const withOwn: DecisionBrief = { ...brief, questions: [{ ...brief.questions[0]!, options: brief.questions[0]!.options.map((o) => (o.id === "images" ? { ...o, criteria: ["Только PNG"] } : o)) }] };

const open = (answer: AnswerRecord | null = null, b: DecisionBrief = brief) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: b.id }, source: `::decision{id="${b.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief: b, answer }), answerBrief: () => ({ kind: "not_found" }), ...({ threadFiles } as object) } as never },
  );

type Slot = ReturnType<typeof open>;

const table = async (slot: Slot) => slot.findByRole("group", { name: "Этапы и бюджет" });
/** Текст строки без цены: цена идёт за названием и начинается с первой цифры. */
const titleOf = (row: HTMLElement) => row.textContent!.replace(/[+–]?\d.*$/, "");
const optionRows = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>("[data-option-criterion]")];
const choose = (slot: Slot, name: RegExp) => fireEvent.click(within(slot.getByRole("group", { name: "Что выкачивать?" })).getByRole("button", { name }));

describe("пункты выбранного варианта в Definition of Done таблицы этапов", () => {
  it("без выбора вариантов в таблице нет", async () => {
    const root = await table(open());
    expect(optionRows(root)).toEqual([]);
  });

  it("вариант, снявший пункт брифа, приносит свой: строка стоит сразу под снятым пунктом, а тот зачёркнут", async () => {
    const slot = open();
    const root = await table(slot);
    choose(slot, /fig/);
    const rows = optionRows(root);
    expect(rows.map(titleOf)).toEqual(["↳Скрипт скачивает .fig каждого файла через браузер"]);
    expect(root.querySelector('[data-criterion="0"]')!.nextElementSibling).toBe(rows[0]);
    expect(rows[0]!.nextElementSibling).toBe(root.querySelector('[data-criterion="1"]'));
    expect(root.querySelector('[data-criterion="0"] .line-through')).toBeTruthy();
  });

  it("вариант, ничего не снявший, стоит в хвосте списка пунктов", async () => {
    const slot = open();
    const root = await table(slot);
    choose(slot, /JSON/);
    expect(root.querySelector('[data-criterion="1"]')!.nextElementSibling).toBe(optionRows(root)[0]);
  });

  it("смена выбора меняет строку: пункт прежнего варианта уходит, пункт нового встаёт", async () => {
    const slot = open();
    const root = await table(slot);
    choose(slot, /fig/);
    choose(slot, /JSON/);
    expect(optionRows(root).map(titleOf)).toEqual(["↳Рядом с PNG лежит JSON дерева слоёв"]);
    expect(root.querySelector('[data-criterion="0"] .line-through')).toBeNull();
  });

  it("пока бриф открыт, пункт отказа от рекомендации зачёркнут", async () => {
    const slot = open(null, withOwn);
    const root = await table(slot);
    choose(slot, /fig/);
    const struck = optionRows(root).find((r) => titleOf(r) === "↳Только PNG");
    expect(struck?.querySelector(".line-through")).toBeTruthy();
  });

  it("в отвеченном брифе остаются только живые пункты вариантов", async () => {
    const record: AnswerRecord = { answer: { briefId: brief.id, answers: [{ questionId: "what", optionIds: ["fig"] }] }, messageId: "msg_1", answeredAt: "2026-09-15T10:00:00.000Z" };
    const root = await table(open(record, withOwn));
    expect(optionRows(root).map(titleOf)).toEqual(["↳Скрипт скачивает .fig каждого файла через браузер"]);
  });
});

describe("цена и чекбоксы строк Definition of Done", () => {
  it("цена варианта стоит на его строке, а отдельной строкой «Вопрос» её нет", async () => {
    const slot = open();
    const root = await table(slot);
    choose(slot, /fig/);
    const text = optionRows(root)[0]!.textContent!;
    expect(text).toContain("$3");
    expect(text).toContain("60 мин");
    expect(root.querySelector("[data-line]")).toBeNull();
  });

  it("у варианта с двумя пунктами цена стоит один раз, на первом", async () => {
    const two: DecisionBrief = { ...brief, questions: [{ ...brief.questions[0]!, options: brief.questions[0]!.options.map((o) => (o.id === "fig" ? { ...o, criteria: ["Первый", "Второй"] } : o)) }] };
    const slot = open(null, two);
    const root = await table(slot);
    choose(slot, /fig/);
    const [first, second] = optionRows(root);
    expect(first!.textContent).toContain("$3");
    expect(second!.textContent).not.toContain("$");
  });

  it("у зачёркнутого пункта варианта цены нет", async () => {
    const slot = open(null, withOwn);
    const root = await table(slot);
    choose(slot, /fig/);
    const struck = optionRows(root).find((r) => titleOf(r) === "↳Только PNG");
    expect(struck?.textContent).not.toContain("$");
  });

  it("у пункта, снятого вариантом, чекбокса нет: нажать его всё равно нельзя", async () => {
    const slot = open();
    const root = await table(slot);
    expect(within(root.querySelector<HTMLElement>('[data-criterion="0"]')!).queryByRole("checkbox")).toBeTruthy();
    choose(slot, /fig/);
    expect(within(root.querySelector<HTMLElement>('[data-criterion="0"]')!).queryByRole("checkbox")).toBeNull();
    expect(within(root.querySelector<HTMLElement>('[data-criterion="1"]')!).queryByRole("checkbox")).toBeTruthy();
  });

  it("без этапа Definition of Done пунктов в таблице нет, а цена варианта остаётся строкой «Вопрос»", async () => {
    const noCriteria: DecisionBrief = { ...brief, id: "dec_no_dod", stages: { list: [stage("work", { skill: "code-standards-fp", name: "Работа" })], minButtonWidth: 170 }, setup: { ...brief.setup!, stages: [report("work", { recommended: true, share: { percent: 100, risk: 1 } })] } };
    const slot = open(null, noCriteria);
    const root = await table(slot);
    choose(slot, /fig/);
    expect(optionRows(root)).toEqual([]);
    expect([...root.querySelectorAll("[data-line]")].some((row) => row.textContent!.includes(".fig-файлы целиком"))).toBe(true);
  });

  it("без этапа работы строка варианта несёт те же числа, что несла бы строка «Вопрос»", async () => {
    const noWork: DecisionBrief = { ...brief, id: "dec_no_work", setup: { ...brief.setup!, stages: [report("criteria", { recommended: true })] }, stages: { list: [CRITERIA], minButtonWidth: 170 } };
    const slot = open(null, noWork);
    const root = await table(slot);
    choose(slot, /fig/);
    expect(root.querySelector("[data-line]")).toBeNull();
    expect(optionRows(root)[0]!.textContent).toContain("$3");
  });

  it("свёрнутый Definition of Done возвращает цену варианта отдельной строкой", async () => {
    const slot = open();
    const root = await table(slot);
    choose(slot, /fig/);
    fireEvent.click(within(root.querySelector<HTMLElement>('[data-stage="criteria"]')!).getByRole("button", { name: "Definition of Done" }));
    expect(root.querySelector("[data-line]")?.textContent).toContain(".fig-файлы целиком");
  });

  it("в отвеченном брифе у пунктов чекбоксов нет", async () => {
    const record: AnswerRecord = { answer: { briefId: brief.id, answers: [{ questionId: "what", optionIds: ["fig"] }] }, messageId: "msg_1", answeredAt: "2026-09-15T10:00:00.000Z" };
    const root = await table(open(record));
    expect(root.querySelectorAll("[data-criterion] [role=checkbox], [data-option-criterion] [role=checkbox]")).toHaveLength(0);
  });
});

describe("пункты вариантов без пунктов брифа", () => {
  it("свёртка Definition of Done остаётся: строки вариантов тоже есть что сворачивать", async () => {
    const { criteria: _criteria, ...setup } = brief.setup!;
    const bare: DecisionBrief = { ...brief, id: "dec_bare_table", setup };
    const slot = open(null, bare);
    const root = await table(slot);
    choose(slot, /fig/);
    const fold = within(root.querySelector<HTMLElement>('[data-stage="criteria"]')!).getByRole("button", { name: "Definition of Done" });
    expect(optionRows(root)).toHaveLength(1);
    fireEvent.click(fold);
    expect(optionRows(root)).toEqual([]);
  });
});
