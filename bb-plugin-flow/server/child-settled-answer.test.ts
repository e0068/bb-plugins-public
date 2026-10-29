// @vitest-environment node
// Живой случай BBPL-942 целиком (BBPL-994): после отката Утверждение снято, повторный бриф запуска потомка решён агентом,
// родитель получает его репликой и берёт в прогон этап, которого потомок не рекомендовал. Автоматизации второй раз не идут.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { stage } from "../core/stages-fixtures";
import { builtinStage } from "../lib/stage-constants";
import type { StageSettings } from "../shared/contract";
import { registerApi } from "./api";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { CHILD_ANSWER_TOOL, registerChildAnswerTool } from "./child-answer-tool";
import { managingParentOf } from "./managing-parent";
import { createProgress } from "./progress";
import { createStore } from "./store";

const CHILD = "thr_child";
const PARENT = "thr_parent";
const T = "2026-10-28T09:10:00.000Z";
const settings: StageSettings = {
  stages: [builtinStage("criteria", []), builtinStage("select", ["criteria"]), builtinStage("approve", ["criteria", "select"]), stage("implement", { skill: "code-standards-fp", name: "Implementation" }), stage("review", { skill: "code-review", name: "Review" })],
  minButtonWidth: 190,
};
const [criteria, select, approve] = settings.stages.map((s) => s.id);
const resent = {
  title: "Выбор этапов после отката",
  setup: {
    criteria: [{ text: "Ревью проходит", add: { target: 1, max: 2, risk: 1, minutes: 10 } }],
    stages: [
      { id: criteria, state: "todo" },
      { id: select, state: "todo" },
      { id: approve, state: "todo" },
      { id: "implement", state: "todo", recommended: true, share: { percent: 100, risk: 0 } },
      { id: "review", state: "todo", recommended: false, share: { percent: 20, risk: -1 } },
    ],
  },
};

const setup = async () => {
  const emitted: string[] = [];
  const told: string[] = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: {
      threads: {
        get: async ({ threadId }: { threadId: string }) => ({ id: threadId, projectId: "proj_1", environmentId: "env_1", status: "active", providerId: "claude-code", title: "Тред", originPluginId: null, parentThreadId: threadId === CHILD ? PARENT : null }),
        send: async () => ({ delivery: "started" }),
      },
    },
  });
  const store = createStore(bb.storage.kv);
  const progress = createProgress(bb.storage.kv);
  await store.markLaunched(CHILD);
  // Первый ответ родителя принял рекомендации: Утверждение и Review сняты из прогона.
  await progress.update(CHILD, (p) => ({ ...p, stages: { ...p.stages, [approve!]: { skipped: true }, review: { skipped: true } } }));
  const { answerBrief, recordDecided } = registerApi(bb, store, { now: () => T, stages: () => settings.stages, progress, emit: (trigger) => void emitted.push(trigger) });
  registerAskTool(bb, store, { newId: () => "C2", now: () => T, stages: () => settings, progress, decided: recordDecided, parentOf: async (id) => (id === CHILD ? PARENT : null), tellParent: async (_, text) => void told.push(text) });
  registerChildAnswerTool(bb, store, { answerBrief, parentOf: managingParentOf(store, bb.sdk), newId: () => "m1" });
  await harness.callAgentTool(ASK_TOOL_NAME, resent, { threadId: CHILD });
  const answer = (args: { briefId: string; include?: string[] }) => harness.callAgentTool(CHILD_ANSWER_TOOL, args, { threadId: PARENT }).then((r) => JSON.stringify(r));
  return { progress, emitted, told, answer };
};

describe("родитель меняет бриф запуска, решённый агентом", () => {
  it("реплика говорит, что решение уже принято, а этап из include встаёт в прогон потомка", async () => {
    const { progress, told, answer } = await setup();
    expect(told[0]).toContain("only to change them");
    expect((await progress.get(CHILD))?.stages.review?.skipped).toBe(true);
    expect(await answer({ briefId: "dec_C2", include: ["review"] })).not.toContain("isError");
    expect((await progress.get(CHILD))?.stages.review?.skipped).toBe(false);
  });

  it("события для автоматизаций идут один раз — при решении агента, а не снова при ответе родителя", async () => {
    const { emitted, answer } = await setup();
    await answer({ briefId: "dec_C2", include: ["review"] });
    expect(emitted).toEqual(["flow.brief-answered", "flow.criteria-approved"]);
  });

  it("ответ без изменений на решённый бриф не принимается: потомка будить не с чем", async () => {
    const { answer } = await setup();
    expect(await answer({ briefId: "dec_C2" })).toContain("already decided");
  });
});
