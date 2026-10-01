// @vitest-environment jsdom
import { cleanup, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DecisionBrief, decisionsRpcContract } from "../shared/contract";
import { threadFiles } from "./file-roots-fixture";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const nested = "- база\n  - пункты с ценой\n    - деньги и минуты одного агента\n- этапы — процент от [объёма](core/budget.ts)";

const brief = (scope?: string): DecisionBrief => ({
  id: "dec_rich",
  threadId: "thr_1",
  title: "Списки в брифе",
  createdAt: "2026-10-01T00:00:00.000Z",
  kind: "brief",
  revocable: true,
  ...(scope === undefined ? {} : { scope }),
  setup: { criteria: [{ text: "База больше нуля", add: { target: 4, max: 6, risk: 0, minutes: 20 } }] },
  questions: [
    { id: "model", kind: "confirm", allowOwn: false, question: "Правильно понял?", context: nested, options: [{ id: "yes", action: "Да", recommended: true }] },
    {
      id: "form",
      kind: "fork",
      allowOwn: false,
      question: "Как считать?",
      options: [
        { id: "a", action: "Процентом", description: "Плагин:\n- считает деньги\n- считает минуты", recommended: true, add: { target: 0, max: 0, risk: 0 } },
        { id: "b", action: "Долларами", description: "Как сейчас", recommended: false, add: { target: 1, max: 1, risk: 0 } },
      ],
    },
  ],
});

const open = (shown: DecisionBrief) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: shown.id }, source: `::decision{id="${shown.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief: shown, answer: null }), answerBrief: () => ({ kind: "not_found" }), ...({ threadFiles } as object) } },
  );

/** Глубина вложенности списков внутри элемента: список в пункте списка — уровень глубже. */
const depth = (root: HTMLElement): number => {
  const lists = within(root).queryAllByRole("list");
  return lists.reduce((max, list) => {
    let level = 1;
    for (let up = list.parentElement; up !== null && up !== root; up = up.parentElement) if (up.getAttribute("role") === "list") level += 1;
    return Math.max(max, level);
  }, 0);
};

describe("многоуровневые списки в тексте брифа", () => {
  it("пояснение вопроса рисует три уровня списком, а не строкой с дефисами", async () => {
    const slot = open(brief());
    const group = await slot.findByRole("group", { name: "Правильно понял?" });
    expect(depth(group)).toBe(3);
    expect(within(group).getByText("деньги и минуты одного агента").closest("[role=listitem]")).not.toBeNull();
    expect(group.textContent).not.toContain("- база");
  });

  it("ссылка внутри пункта остаётся ссылкой", async () => {
    const slot = open(brief());
    const group = await slot.findByRole("group", { name: "Правильно понял?" });
    expect(within(group).getByRole("link", { name: "объёма" }).closest("[role=listitem]")).not.toBeNull();
  });

  it("описание варианта рисует список списком", async () => {
    const slot = open(brief());
    const option = await slot.findByRole("button", { name: /Процентом/ });
    expect(within(option).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["считает деньги", "считает минуты"]);
  });

  it("блок «Что я понял» стоит первым в вопросах и рисует список", async () => {
    const slot = open(brief(nested));
    const scope = await slot.findByRole("group", { name: "Что я понял" });
    expect(depth(scope)).toBe(3);
    const firstQuestion = slot.getByRole("group", { name: "Правильно понял?" });
    expect(scope.compareDocumentPosition(firstQuestion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("бриф без scope блока «Что я понял» не рисует", async () => {
    const slot = open(brief());
    await slot.findByRole("group", { name: "Правильно понял?" });
    expect(slot.queryByRole("group", { name: "Что я понял" })).toBeNull();
  });
});
