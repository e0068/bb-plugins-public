// @vitest-environment node
// Родитель берёт в прогон потомка этап, которого потомок не рекомендовал: ответ ложится, как выбор этапа кнопкой (BBPL-994).
// Живой случай — BBPL-942: родитель написал «этап Demonstration обязателен», а ответ принял рекомендации, и демонстрация осталась снята.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { stage } from "../core/stages-fixtures";
import type { DecisionBrief, WorkStage } from "../shared/contract";
import { registerApi } from "./api";
import { CHILD_ANSWER_TOOL, registerChildAnswerTool } from "./child-answer-tool";
import { managingParentOf } from "./managing-parent";
import { createProgress } from "./progress";
import { createStore } from "./store";

const CHILD = "thr_child";
const PARENT = "thr_parent";
const T0 = "2026-10-28T09:00:00.000Z";

const list: WorkStage[] = [
  stage("reproduce", { name: "Reproduce" }),
  stage("implement", { skill: "code-standards-fp", name: "Implementation" }),
  { id: "demo", kind: "demo", skill: "", name: "Demonstration", executors: [] },
];

const launch: DecisionBrief = {
  id: "dec_l",
  threadId: CHILD,
  title: "Выбор этапов потомка",
  createdAt: T0,
  kind: "brief",
  questions: [],
  setup: {
    stages: [
      { id: "reproduce", state: "done", recommended: false, executor: "self", results: [{ label: "repro.test.ts", target: "repro.test.ts" }] },
      { id: "implement", state: "todo", recommended: true, executor: "self", share: { percent: 100, risk: 0 } },
      { id: "demo", state: "todo", recommended: false, executor: "self" },
    ],
  },
  stages: { list, minButtonWidth: 170 },
};

const setup = async () => {
  const sent: string[] = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: {
      threads: {
        get: async ({ threadId }: { threadId: string }) => ({ id: threadId, projectId: "proj_1", environmentId: "env_1", status: "active", providerId: "claude-code", title: "Тред", originPluginId: null, parentThreadId: threadId === CHILD ? PARENT : null }),
        send: async (args: { threadId: string }) => {
          sent.push(args.threadId);
          return { delivery: "started" };
        },
      },
    },
  });
  const store = createStore(bb.storage.kv);
  const progress = createProgress(bb.storage.kv);
  await store.putBrief(launch);
  await progress.recordBrief(launch, T0);
  const { answerBrief } = registerApi(bb, store, { now: () => T0, stages: () => list, progress });
  registerChildAnswerTool(bb, store, { answerBrief, parentOf: managingParentOf(store, bb.sdk), newId: () => "m1" });
  const answer = (args: { briefId: string; include?: string[] }) => harness.callAgentTool(CHILD_ANSWER_TOOL, args, { threadId: PARENT }).then((r) => JSON.stringify(r));
  return { store, progress, sent, answer };
};

describe("родитель берёт этап в прогон потомка", () => {
  it("Demonstration, которую потомок не рекомендовал, встаёт в его прогон и не снята", async () => {
    const { store, progress, sent, answer } = await setup();
    const result = await answer({ briefId: "dec_l", include: ["demo"] });
    expect(result).not.toContain("isError");
    expect((await store.getAnswer("dec_l"))?.answer.stages?.find((s) => s.id === "demo")?.run).toBe(true);
    expect((await progress.get(CHILD))?.stages.demo?.skipped).not.toBe(true);
    expect(sent).toEqual([CHILD]);
  });

  it("без списка этапов прогон остаётся рекомендованным: Demonstration снята", async () => {
    const { progress, answer } = await setup();
    await answer({ briefId: "dec_l" });
    expect((await progress.get(CHILD))?.stages.demo?.skipped).toBe(true);
  });

  it("этап не из брифа или уже пройденный взять нельзя: ответа нет, потомку ничего не уходит", async () => {
    const { store, sent, answer } = await setup();
    expect(await answer({ briefId: "dec_l", include: ["nope"] })).toContain("nope");
    expect(await answer({ briefId: "dec_l", include: ["reproduce"] })).toContain("reproduce");
    expect(await store.getAnswer("dec_l")).toBeNull();
    expect(sent).toEqual([]);
  });
});
