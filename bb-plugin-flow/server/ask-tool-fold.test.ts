// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionAnswer, StageSettings } from "../shared/contract";
import { ASK_TOOL_NAME, RETURNED_RULE, registerAskTool } from "./ask-tool";
import { createStore } from "./store";

const THREAD = "thr_fold";
const T = "2026-10-12T10:00:00.000Z";
const settings: StageSettings = { stages: [builtinStage("demo", []), builtinStage("approve", ["demo"])], minButtonWidth: 190 };

const questions = (title: string) => ({ title, questions: [{ id: "go", kind: "confirm", question: "Так?", options: [{ id: "yes", action: "Yes" }] }] });
const clarify = (title: string) => ({ title, kind: "clarify", questions: [{ id: "ok", question: "Так?", kind: "yesno", options: [{ id: "yes", action: "Yes" }, { id: "no", action: "No" }] }] });
const outcome = (stage: string) => ({ stage, final: false, next: "Дальше", done: ["Сделано"], pending: [], results: [{ label: "task.md", target: "docs/tasks/task.md" }], documentsOnly: true as const });
const demo = (title: string) => ({ title, outcome: outcome("demo"), questions: [] });
const approval = (title: string) => ({ title, outcome: outcome("approve"), questions: [] });

const textOf = (result: unknown): string =>
  typeof result === "string" ? result : ((result as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? "").join("");

const host = async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  await store.markLaunched(THREAD);
  let n = 0;
  registerAskTool(bb, store, { newId: () => `K${++n}`, now: () => T, stages: () => settings });
  const ask = async (input: unknown) => textOf(await harness.callAgentTool(ASK_TOOL_NAME, input, { threadId: THREAD }));
  /** Комментарий владельца к утверждению: ответ записан, группа свёрнута, указатель возврата на утверждении. */
  const comment = async (holder: string) => {
    const answer: DecisionAnswer = { briefId: holder, answers: [], outcome: { accepted: false, note: "поправь" } };
    await store.putAnswer(holder, { answer, messageId: "m", answeredAt: T });
    await store.foldGroup(THREAD, holder);
    await store.putThreadReturned(THREAD, holder);
  };
  const answer = async (id: string, optionId: string) =>
    store.putAnswer(id, { answer: { briefId: id, answers: [{ questionId: "go", optionIds: [optionId] }] }, messageId: "m", answeredAt: T });
  return { ask, store, comment, answer, harness };
};

describe("список группы треда", () => {
  it("растёт с каждым брифом, пока утверждения не было, а утверждение его замыкает", async () => {
    const { ask, store } = await host();
    await ask(questions("Первый"));
    await ask(clarify("Уточнение"));
    await ask(demo("Демо"));
    expect(await store.getThreadGroup(THREAD)).toEqual({ ids: ["dec_K1", "dec_K2", "dec_K3"], lastApprove: false, folded: false });
    await ask(approval("Утверждение"));
    expect(await store.getThreadGroup(THREAD)).toEqual({ ids: ["dec_K1", "dec_K2", "dec_K3", "dec_K4"], lastApprove: true, folded: false });
  });

  it("бриф после утверждения начинает список заново", async () => {
    const { ask, store } = await host();
    await ask(approval("Утверждение"));
    await ask(questions("Новый"));
    expect(await store.getThreadGroup(THREAD)).toEqual({ ids: ["dec_K2"], lastApprove: false, folded: false });
  });

  it("отвергнутый бриф список не меняет", async () => {
    const { ask, store } = await host();
    await ask(questions("Первый"));
    expect(await ask({ title: "Утв", outcome: outcome("nope"), questions: [] })).toContain("Brief not accepted");
    expect((await store.getThreadGroup(THREAD))?.ids).toEqual(["dec_K1"]);
  });
});

describe("группа утверждения, свёрнутая после того, как пришёл другой бриф", () => {
  it("q1, q2, утверждение, уточнение, затем комментарий: сворачиваются q1, q2 и утверждение, а список треда не перезаписывается", async () => {
    const { ask, store, comment } = await host();
    await ask(questions("q1"));
    await ask(questions("q2"));
    await ask(approval("Утверждение"));
    await ask(clarify("c1"));
    await comment("dec_K3");
    for (const id of ["dec_K1", "dec_K2", "dec_K3"]) expect(await store.getFold(id)).toEqual({ holder: "dec_K3", ids: ["dec_K1", "dec_K2", "dec_K3"] });
    expect(await store.getFold("dec_K4")).toBeNull();
    expect(await store.getThreadGroup(THREAD)).toEqual({ ids: ["dec_K4"], lastApprove: false, folded: true });
  });

  it("то же с любым брифом после утверждения: доработанный бриф вопросов группу утверждения не размывает", async () => {
    const { ask, store, comment } = await host();
    await ask(questions("q1"));
    await ask(approval("Утверждение"));
    await ask(questions("c1"));
    await comment("dec_K2");
    expect((await store.getFold("dec_K1"))?.ids).toEqual(["dec_K1", "dec_K2"]);
    expect(await store.getFold("dec_K3")).toBeNull();
  });
});

describe("утверждение вслед за свёрнутым утверждением", () => {
  it("без доработанных виджетов отбито: отказ называет, что прислать, и бриф не записан", async () => {
    const { ask, store, comment } = await host();
    await ask(questions("Первый"));
    await ask(approval("Утверждение"));
    await comment("dec_K2");
    const refused = await ask(approval("Снова"));
    expect(refused).toContain("Brief not accepted");
    expect(refused).toContain("reworked widgets");
    expect(await store.getBrief("dec_K3")).toBeNull();
  });

  it("после брифа вопросов принято", async () => {
    const { ask, store, comment } = await host();
    await ask(approval("Утверждение"));
    await comment("dec_K1");
    await ask(questions("Доработанный"));
    expect(await ask(approval("Снова"))).toContain("dec_K3");
    expect((await store.getBrief("dec_K3"))?.outcome?.stage).toBe("approve");
  });

  it("после Демонстрации принято: она не утверждение", async () => {
    const { ask, comment } = await host();
    await ask(approval("Утверждение"));
    await comment("dec_K1");
    await ask(demo("Демо"));
    expect(await ask(approval("Снова"))).toContain("dec_K3");
  });

  it("уточнение доработкой не считается: утверждение по-прежнему отбито", async () => {
    const { ask, comment } = await host();
    await ask(approval("Утверждение"));
    await comment("dec_K1");
    await ask(clarify("Уточнение"));
    expect(await ask(approval("Снова"))).toContain("reworked widgets");
  });

  it("без комментария — «Продолжить» — следующее утверждение ничем не заперто", async () => {
    const { ask, store } = await host();
    await ask(approval("Утверждение"));
    await store.putAnswer("dec_K1", { answer: { briefId: "dec_K1", answers: [], outcome: { accepted: true } }, messageId: "m", answeredAt: T });
    expect(await ask(approval("Следующее"))).toContain("dec_K2");
  });

  it("Демонстрация и вопросы после свёрнутого утверждения не заперты", async () => {
    const { ask, comment } = await host();
    await ask(approval("Утверждение"));
    await comment("dec_K1");
    expect(await ask(demo("Демо"))).toContain("dec_K2");
    expect(await ask(questions("Вопросы"))).toContain("dec_K3");
  });
});

describe("новые виджеты после свёрнутой группы", () => {
  it("получают выбор всей группы: ответы отвеченных и черновики неотвеченных, от старого к новому", async () => {
    const { ask, store, comment, answer } = await host();
    await ask(questions("Первый"));
    await ask(questions("Второй"));
    await ask(approval("Утверждение"));
    await answer("dec_K1", "yes");
    await store.putDraft("dec_K2", "{черновик}");
    await comment("dec_K3");
    expect(await ask(questions("Доработанный"))).toMatch(/preselected/);
    const restored = (await store.getBrief("dec_K4"))?.restored;
    expect(restored?.sources).toEqual([
      { answer: { briefId: "dec_K1", answers: [{ questionId: "go", optionIds: ["yes"] }] } },
      { draft: "{черновик}" },
      { answer: { briefId: "dec_K3", answers: [], outcome: { accepted: false, note: "поправь" } } },
    ]);
  });

  it("второй и следующий виджеты тоже получают выбор: указатель держится, пока не пришло следующее утверждение", async () => {
    const { ask, store, comment, answer } = await host();
    await ask(questions("Первый"));
    await ask(approval("Утверждение"));
    await answer("dec_K1", "yes");
    await comment("dec_K2");
    await ask(questions("Доработанный 1"));
    expect(await store.getThreadReturned(THREAD)).toBe("dec_K2");
    await ask(demo("Демо"));
    expect(await store.getThreadReturned(THREAD)).toBe("dec_K2");
    await ask(questions("Доработанный 2"));
    expect((await store.getBrief("dec_K5"))?.restored?.sources).toHaveLength(2);
    expect(await store.getThreadReturned(THREAD)).toBe("dec_K2");
  });

  it("следующее утверждение снимает указатель: после него выбор прошлой группы никому не достаётся", async () => {
    const { ask, store, comment } = await host();
    await ask(approval("Утверждение"));
    await comment("dec_K1");
    await ask(questions("Доработанный"));
    await ask(approval("Снова"));
    expect(await store.getThreadReturned(THREAD)).toBeNull();
    await ask(questions("Дальше"));
    expect((await store.getBrief("dec_K4"))?.restored).toBeUndefined();
  });

  it("черновики свёрнутых не стираются: раскрытая строка их покажет", async () => {
    const { ask, store, comment } = await host();
    await ask(questions("Первый"));
    await ask(approval("Утверждение"));
    await store.putDraft("dec_K1", "{черновик}");
    await comment("dec_K2");
    await ask(questions("Доработанный"));
    await ask(approval("Снова"));
    expect(await store.getDraft("dec_K1")).toBe("{черновик}");
  });

  it("нетронутый виджет группы передаёт дальше выбор, который сам принёс", async () => {
    const { ask, store, comment } = await host();
    await ask(questions("Первый"));
    await ask(approval("Утверждение"));
    await store.putDraft("dec_K1", "{черновик}");
    await comment("dec_K2");
    await ask(questions("Доработанный"));
    await ask(approval("Снова"));
    await comment("dec_K4");
    await ask(questions("Ещё раз"));
    expect((await store.getBrief("dec_K5"))?.restored?.sources?.map((s) => s.draft ?? s.answer?.briefId)).toContain("{черновик}");
  });

  it("группы без единого выбора нет: бриф идёт без записи, указатель держится", async () => {
    const { ask, store } = await host();
    await ask(approval("Утверждение"));
    await store.foldGroup(THREAD, "dec_K1");
    await store.putThreadReturned(THREAD, "dec_K1");
    await ask(questions("Доработанный"));
    expect((await store.getBrief("dec_K2"))?.restored).toBeUndefined();
    expect(await store.getThreadReturned(THREAD)).toBe("dec_K1");
  });
});

describe("виджет, возвращённый сообщением в чат", () => {
  it("забирается следующим брифом, как прежде; его черновик остаётся — раскрытая строка его покажет", async () => {
    const { ask, store } = await host();
    await ask(questions("Первый"));
    await store.putDraft("dec_K1", "{черновик}");
    await store.foldSingle("dec_K1");
    await store.putThreadReturned(THREAD, "dec_K1");
    await ask(questions("Второй"));
    expect((await store.getBrief("dec_K2"))?.restored).toEqual({ sources: [{ draft: "{черновик}" }] });
    expect(await store.getThreadReturned(THREAD)).toBeNull();
    expect(await store.getDraft("dec_K1")).toBe("{черновик}");
  });
});

describe("наказ агенту в описании инструмента", () => {
  it("сообщение при ждущем утверждении: вернулась вся группа, прислать доработанные виджеты, потом утверждение", () => {
    expect(RETURNED_RULE).toMatch(/approval/);
    expect(RETURNED_RULE).toMatch(/reworked widgets/);
  });
});
