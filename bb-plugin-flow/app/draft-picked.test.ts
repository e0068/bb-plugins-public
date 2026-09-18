// @vitest-environment node
import { describe, expect, it } from "vitest";

import { SETUP_ROW, rowsOf } from "../core/rows";
import type { BriefSetup, DecisionBrief } from "../shared/contract";
import { acceptRecommendations, decidedCount, initialDraft, isPicked, pickOption } from "./draft";
import { decodeDraft, encodeDraft } from "./draft-storage";

const briefWith = (setup: Record<string, unknown>, questions: DecisionBrief["questions"] = []): DecisionBrief => ({
  id: "dec_picked",
  threadId: "thr_1",
  title: "Бриф",
  createdAt: "2026-09-14T00:00:00.000Z",
  kind: "brief",
  revocable: true,
  setup: setup as BriefSetup,
  questions,
});

const models = [{ name: "Opus 5", recommended: true }];

const brief = briefWith(
  {
    artifacts: [
      { id: "task", name: "Задача", state: "approved", recommended: false, link: { label: "SL-1", target: "t.md" } },
      { id: "prototype", name: "HTML-прототип", state: "ready", recommended: true, link: { label: "p.html", target: "p.html" } },
      { id: "spec", name: "Спецификация", state: "missing", recommended: false },
      { id: "plan", name: "План", state: "missing", recommended: false },
    ],
    executor: { recommended: "self" },
    checker: { recommended: "agent", models },
    testing: { recommended: "self", models },
    budgetTarget: { options: [{ id: "none", action: "—", recommended: false }, { id: "b15", action: "$15", recommended: true }] },
  },
  [{ id: "read", question: "Так?", kind: "confirm", allowOwn: false, options: [{ id: "yes", action: "Да", recommended: true }] }],
);

const row = (b: DecisionBrief, id: string) => rowsOf(b).find((r) => r.id === id)!;
const setupRows = [SETUP_ROW.artifacts, SETUP_ROW.executor, SETUP_ROW.checker, SETUP_ROW.testing];

describe("метка выбора владельца", () => {
  it("открытый бриф ничего не отмечает выбранным", () => {
    const draft = initialDraft(brief);
    for (const id of setupRows) expect(isPicked(draft, id)).toBe(false);
  });

  it("выбор рекомендованного отмечает строку выбранной", () => {
    const draft = pickOption(initialDraft(brief), row(brief, SETUP_ROW.executor), "self", brief);
    expect(draft.entries[SETUP_ROW.executor]?.optionIds).toEqual(["self"]);
    expect(isPicked(draft, SETUP_ROW.executor)).toBe(true);
    expect(isPicked(draft, SETUP_ROW.checker)).toBe(false);
    const ticked = pickOption(draft, row(brief, SETUP_ROW.artifacts), "spec", brief);
    expect(isPicked(ticked, SETUP_ROW.artifacts)).toBe(true);
  });

  it("Принять рекомендации снимает отметки", () => {
    const picked = pickOption(initialDraft(brief), row(brief, SETUP_ROW.checker), "none", brief);
    const accepted = acceptRecommendations(brief, picked);
    expect(accepted.entries[SETUP_ROW.checker]?.optionIds).toEqual(["agent:Opus 5"]);
    for (const id of setupRows) expect(isPicked(accepted, id)).toBe(false);
  });

  it("черновик с отметкой переживает хранилище", () => {
    const picked = pickOption(initialDraft(brief), row(brief, SETUP_ROW.testing), "none", brief);
    const read = decodeDraft(encodeDraft(picked));
    expect(read === null ? false : isPicked(read, SETUP_ROW.testing)).toBe(true);
  });

  it("тестирование стоит на рекомендации при открытии", () => {
    const draft = initialDraft(brief);
    expect(draft.entries[SETUP_ROW.executor]?.optionIds).toEqual(["self"]);
    expect(draft.entries[SETUP_ROW.checker]?.optionIds).toEqual(["agent:Opus 5"]);
    expect(draft.entries[SETUP_ROW.testing]?.optionIds).toEqual(["self"]);
    expect(draft.entries[SETUP_ROW.artifacts]?.optionIds).toEqual(["task", "prototype"]);
    expect(draft.entries[SETUP_ROW.budgetTarget]).toBeUndefined();
    expect(draft.entries.read).toBeUndefined();
    expect(decidedCount(brief, draft)).toEqual({ decided: 4, total: 6 });
  });
});

describe("смена исполнителя не оставляет ревью и тестирование в рамках workflow без workflow", () => {
  const onWorkflow = (recommended: string) => {
    const b = briefWith({ executor: { recommended: "workflow" }, checker: { recommended, models: [{ name: "Opus 5", recommended: recommended === "agent" }] }, testing: { recommended, models: [{ name: "Opus 5", recommended: recommended === "agent" }] } });
    const start = pickOption(initialDraft(b), row(b, SETUP_ROW.executor), "workflow", b);
    const both = [SETUP_ROW.checker, SETUP_ROW.testing].reduce((d, id) => pickOption(d, row(b, id), "workflow", b), start);
    return { b, self: pickOption(both, row(b, SETUP_ROW.executor), "self", b) };
  };

  it("смена исполнителя уводит недопустимое тестирование к рекомендации, иначе к Нет", () => {
    const agent = onWorkflow("agent");
    expect(agent.self.entries[SETUP_ROW.checker]?.optionIds).toEqual(["agent:Opus 5"]);
    expect(agent.self.entries[SETUP_ROW.testing]?.optionIds).toEqual(["agent:Opus 5"]);
    const workflow = onWorkflow("workflow");
    expect(workflow.self.entries[SETUP_ROW.checker]?.optionIds).toEqual(["none"]);
    expect(workflow.self.entries[SETUP_ROW.testing]?.optionIds).toEqual(["none"]);
    expect(decidedCount(workflow.b, workflow.self)).toEqual({ decided: 3, total: 3 });
    expect(isPicked(workflow.self, SETUP_ROW.testing)).toBe(false);
  });
});

describe("Принять рекомендации и своя цена", () => {
  it("Принять рекомендации снимает свою цену: бюджет снова на прогнозе", () => {
    const own = { ...initialDraft(brief), budget: { target: "$20", max: "$40" } };
    expect(acceptRecommendations(brief, own).budget).toEqual({ target: "", max: "" });
  });
});
