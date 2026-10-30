// @vitest-environment node
// Агент предлагает flow на Утверждении (BBPL-1005): в треде с Утверждением указания хода говорят, когда класть outcome.nextFlow,
// и называют flow владельца — иначе агент, поправивший код на flow без мёржа, спрашивает владельца, как довезти работу.
import { createFakePluginHost, makeMessageDispatchHookContext, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { addFlow, newFlow } from "./core/flows";
import { QUICK_STAGES, stage } from "./core/stages-fixtures";
import { INSTRUCTIONS_LIMIT_CHARS } from "./lib/agent-limits";
import type { FlowSettings, WorkStage } from "./shared/contract";
import plugin from "./server";

/** Flow ответа: этап-навык, Утверждение и архив треда за ним — коммита и мёржа впереди нет. */
const ANSWER_STAGES: WorkStage[] = [
  stage("corpus", { skill: "corpus", name: "Corpus" }),
  { id: "approve", kind: "approve", skill: "", name: "Approval", executors: [] },
  { id: "archive", kind: "skill", skill: "", name: "Archive", executors: [], automation: { source: "flow", steps: ["bb.archive"] } },
];

const setup = async (flowId: string, extra: ReadonlyArray<{ id: string; name: string }> = []) => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: { threads: { get: async ({ threadId }: { threadId: string }) => ({ id: threadId, projectId: "proj_1", environmentId: "env_1", status: "idle", providerId: "claude", title: "Ответ" }) } },
  });
  await plugin(bb);
  const current = await harness.callRpc<FlowSettings>("getFlowSettings", {});
  const withAnswer = addFlow(current, { ...newFlow("answer", "Answer"), stages: ANSWER_STAGES });
  const withQuick = addFlow(withAnswer, { ...newFlow("quick", "Quick"), stages: QUICK_STAGES });
  await harness.callRpc("saveFlowSettings", extra.reduce((settings, flow) => addFlow(settings, { ...newFlow(flow.id, flow.name), stages: QUICK_STAGES }), withQuick));
  await harness.callRpc("setFlowChoice", { projectId: "proj_1", flowId });
  const thread = makeThreadResponse({ id: "thr_src", projectId: "proj_1", parentThreadId: null, status: "pending" });
  await harness.emitThreadEvent("thread.created", { thread });
  await harness.registrations.hooks["message.dispatch"]!({ ...makeMessageDispatchHookContext({ thread }), initiator: "user" } as never);
  return harness.registrations.instructionProvider?.({ threadId: "thr_src", projectId: "proj_1" }) ?? "";
};

describe("агент предлагает flow на Утверждении", () => {
  it("в flow с Утверждением указания хода велят предложить flow, если работа не доедет до main, и называют flow владельца", async () => {
    const instructions = await setup("answer");
    expect(instructions).toContain("outcome.nextFlow");
    expect(instructions).toMatch(/main/);
    expect(instructions).toContain('quick "Quick"');
  });

  it("в flow без Утверждения предлагать flow негде — указания о нём молчат", async () => {
    const instructions = await setup("quick");
    expect(instructions).not.toContain("outcome.nextFlow");
  });

  it("длинный список flow не вытесняет этапы: указания влезают в лимит bb и кончаются этапами треда", async () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ id: `flow-${i}-${"x".repeat(20)}`, name: `Очень длинное название flow номер ${i}` }));
    const instructions = await setup("answer", many);
    expect(instructions.length).toBeLessThanOrEqual(INSTRUCTIONS_LIMIT_CHARS);
    expect(instructions).toContain('archive "Archive"');
    expect(instructions).toContain("outcome.nextFlow");
  });
});
