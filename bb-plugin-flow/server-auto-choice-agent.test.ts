// @vitest-environment node
// Агент flow на живом сервере Flow: тред с «Автоматически» стартует с моделью строки «Автоматически», а выбор flow агентом
// ставит модель выбранного flow и отдаёт его стартовое сообщение в ответе — без новой сессии и без повтора первого сообщения.
import { createFakePluginHost, makeMessageDispatchHookContext, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { addFlow, AUTO_FLOW, newFlow } from "./core/flows";
import { QUICK_STAGES } from "./core/stages-fixtures";
import { CHOOSE_FLOW_TOOL } from "./lib/stage-constants";
import type { FlowSettings } from "./shared/contract";
import plugin from "./server";

const text = (result: unknown) => (typeof result === "string" ? result : JSON.stringify(result));
const flush = () => new Promise((resolve) => setTimeout(resolve, 50));

const setup = async (providerId = "claude-code") => {
  const cleared: string[] = [];
  const sent: string[] = [];
  const updates: Array<Record<string, unknown>> = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: {
      threads: {
        get: async ({ threadId }: { threadId: string }) => ({ id: threadId, projectId: "proj_auto", environmentId: "env_1", status: "idle", providerId, title: "Тред" }),
        update: async (args: Record<string, unknown>) => {
          updates.push(args);
          return { ok: true };
        },
        clearContext: async ({ threadId }: { threadId: string }) => void cleared.push(threadId),
        send: async ({ threadId }: { threadId: string }) => {
          sent.push(threadId);
          return { delivery: "started" };
        },
      },
      environments: { get: async () => ({ hostId: "host_1", path: "/nonexistent/flow-auto-choice-tree", branchName: "bb/thr_auto", isWorktree: true }) },
    },
  });
  await plugin(bb);
  const current = await harness.callRpc<FlowSettings>("getFlowSettings", {});
  const quick = { ...newFlow("quick", "Quick"), description: "Мелкие правки", stages: QUICK_STAGES, agent: { execution: { providerId: "claude-code", model: "sonnet", reasoningLevel: "medium" as const }, start: "Правь коротко" } };
  await harness.callRpc("saveFlowSettings", { ...addFlow(current, quick), autoAgent: { execution: { providerId: "claude-code", model: "haiku", reasoningLevel: "low" as const } } });
  await harness.callRpc("setFlowChoice", { projectId: "proj_auto", flowId: AUTO_FLOW });
  const thread = makeThreadResponse({ id: "thr_auto", projectId: "proj_auto", parentThreadId: null, status: "pending" });
  await harness.emitThreadEvent("thread.created", { thread });
  await harness.registrations.hooks["message.dispatch"]!({ ...makeMessageDispatchHookContext({ thread }), initiator: "user" } as never);
  const choose = () => harness.callAgentTool(CHOOSE_FLOW_TOOL, { flowId: "quick" }, { threadId: "thr_auto" });
  const turnEnds = async () => {
    await harness.emitThreadEvent("thread.idle", { thread: makeThreadResponse({ id: "thr_auto", projectId: "proj_auto", parentThreadId: null }) });
    await flush();
  };
  return { choose, turnEnds, cleared, sent, updates };
};

describe("агент flow у треда с «Автоматически»", () => {
  it("первое сообщение ставит модель строки «Автоматически»", async () => {
    const { updates } = await setup();
    expect(updates).toEqual([{ threadId: "thr_auto", model: "haiku", reasoningLevel: "low" }]);
  });

  it("выбор flow: модель выбранного flow, его стартовое сообщение и этапы в ответе; контекст не чистится, сообщение не повторяется", async () => {
    const { choose, turnEnds, cleared, sent, updates } = await setup();
    const answer = text(await choose());
    expect(answer).toContain("Правь коротко");
    expect(answer).toMatch(/2\. implement/);
    expect(updates.at(-1)).toEqual({ threadId: "thr_auto", model: "sonnet", reasoningLevel: "medium" });
    await turnEnds();
    expect(cleared).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("тред другого провайдера модель flow не получает, а стартовое сообщение — получает", async () => {
    const { choose, updates } = await setup("codex");
    expect(text(await choose())).toContain("Правь коротко");
    expect(updates).toEqual([]);
  });
});
