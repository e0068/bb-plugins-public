// @vitest-environment node
// Родитель отвечает на бриф запуска своего потомка инструментом: ответ ложится, как ответ кнопкой, и доходит до дочернего треда.
// Утверждение потомка принимает только владелец (BBPL-951).
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionBrief } from "../shared/contract";
import { registerApi } from "./api";
import { CHILD_ANSWER_TOOL, registerChildAnswerTool } from "./child-answer-tool";
import { managingParentOf } from "./managing-parent";
import { createStore } from "./store";

const CHILD = "thr_child";
const PARENT = "thr_parent";

const launch: DecisionBrief = {
  id: "dec_l",
  threadId: CHILD,
  title: "Вопросы запуска",
  createdAt: "2026-10-27T21:00:00.000Z",
  kind: "brief",
  questions: [{ id: "where", question: "Где чинить?", kind: "pick", allowOwn: false, options: [{ id: "a", action: "В плагине", description: "Правка Flow", recommended: true }, { id: "b", action: "В bb", description: "Правка хоста", recommended: false }] }],
};

const approval: DecisionBrief = {
  id: "dec_a",
  threadId: CHILD,
  title: "Утверждение запуска",
  createdAt: "2026-10-27T21:00:00.000Z",
  kind: "brief",
  questions: [],
  outcome: { stage: "approve", final: false, next: "Implementation", done: ["Definition of Done — два пункта"], pending: [], results: [{ label: "BBPL-951", target: "BBPL-951" }] },
  stages: { list: [builtinStage("approve", [])], minButtonWidth: 160 },
};

const setup = async () => {
  const sent: Array<{ threadId: string; text: string }> = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: {
      threads: {
        get: async ({ threadId }: { threadId: string }) => ({ id: threadId, projectId: "proj_1", environmentId: "env_1", status: "active", providerId: "claude-code", title: "Тред", originPluginId: null, parentThreadId: threadId === CHILD ? PARENT : null }),
        send: async (args: { threadId: string; input: Array<{ type: string; text?: string }> }) => {
          sent.push({ threadId: args.threadId, text: args.input.map((part) => part.text ?? "").join("\n") });
          return { delivery: "started" };
        },
      },
    },
  });
  const store = createStore(bb.storage.kv);
  await store.putBrief(launch);
  await store.putBrief(approval);
  const { answerBrief } = registerApi(bb, store, { now: () => "2026-10-27T21:05:00.000Z" });
  registerChildAnswerTool(bb, store, { answerBrief, parentOf: managingParentOf(store, bb.sdk), newId: () => "m1" });
  const answer = (args: { briefId: string; comment?: string }, threadId: string) => harness.callAgentTool(CHILD_ANSWER_TOOL, args, { threadId }).then((r) => JSON.stringify(r));
  return { store, sent, answer };
};

describe("ответ родителя на бриф потомка", () => {
  it("бриф запуска принимается рекомендованными вариантами и доходит до дочернего треда", async () => {
    const { store, sent, answer } = await setup();
    const result = await answer({ briefId: "dec_l" }, PARENT);
    expect(result).not.toContain("isError");
    expect((await store.getAnswer("dec_l"))?.answer.answers).toEqual([{ questionId: "where", optionIds: ["a"] }]);
    expect(sent.map((s) => s.threadId)).toEqual([CHILD]);
    expect(sent[0]!.text).toContain("Вопросы запуска");
  });

  it("комментарий родителя доходит до потомка заметкой к брифу", async () => {
    const { store, sent, answer } = await setup();
    await answer({ briefId: "dec_l", comment: "Сначала тест на маршрут" }, PARENT);
    expect((await store.getAnswer("dec_l"))?.answer.note).toBe("Сначала тест на маршрут");
    expect(sent[0]!.text).toContain("Сначала тест на маршрут");
  });

  it("Утверждение потомка родитель не принимает: оно остаётся владельцу без ответа", async () => {
    const { store, sent, answer } = await setup();
    const result = await answer({ briefId: "dec_a" }, PARENT);
    expect(result).toContain("the owner answers");
    expect(await store.getAnswer("dec_a")).toBeNull();
    expect(sent).toEqual([]);
  });

  it("чужой тред ответить не может: бриф остаётся без ответа", async () => {
    const { store, sent, answer } = await setup();
    const result = await answer({ briefId: "dec_l" }, "thr_other");
    expect(result).toContain("not a brief of your child thread");
    expect(await store.getAnswer("dec_l")).toBeNull();
    expect(sent).toEqual([]);
  });
});
