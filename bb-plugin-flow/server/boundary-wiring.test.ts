// @vitest-environment node
// Стык границы этапов с входом сервера: настоящие поверхности хоста вместо подставленных в registerProgress аргументов.
// Замер контекста, модель треда и каталог моделей читаются из bb, а будящая реплика Flow идёт через обёртку send.
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { addFlow, newFlow } from "../core/flows";
import { stage } from "../core/stages-fixtures";
import type { WorkStage } from "../shared/contract";
import plugin from "../server";
import { FLOW_STAGE_TOOL } from "./progress";

const THREAD = "thr_boundary_wiring";

const usageEvent = (usedTokens: number) => ({
  type: "thread/contextWindowUsage/updated",
  data: { providerThreadId: "s1", contextWindowUsage: { usedTokens, modelContextWindow: 1_000_000, estimated: true } },
});

const archive: WorkStage = { id: "archive", kind: "skill", skill: "", name: "Archive", executors: [], automation: { source: "flow", steps: ["bb.archive"] } };

type Approved = Record<string, { providerId: string; model: string; reasoningLevel: "medium" | "high" }>;

const boot = async (stages: WorkStage[], options: { used: number; model: string; approved?: Approved }) => {
  const calls: string[] = [];
  const sent: string[] = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: {
      threads: {
        get: async () => ({ id: THREAD, providerId: "claude-code", status: "active", environmentId: null, title: null, projectId: "proj_a" }),
        defaultExecutionOptions: async () => ({ model: options.model, reasoningLevel: "medium" }),
        events: { list: async () => [usageEvent(options.used)] },
        wait: async () => (calls.push("wait"), { matched: true }),
        compact: async () => (calls.push("compact"), { ok: true }),
        update: async (args: { model?: string | null | undefined; reasoningLevel?: string | null | undefined }) => (calls.push(`update:${args.model}/${args.reasoningLevel}`), {}),
        send: async (args: { mode?: string | undefined; input: ReadonlyArray<{ type: string; text?: string }> }) => (calls.push(`send:${args.mode}`), sent.push(args.input[0]?.text ?? ""), { delivery: "queued" }),
        stop: async () => ({}),
        archive: async () => ({}),
      },
      providers: {
        models: async () => ({
          providers: [{ id: "claude-code", available: true }],
          models: [
            { model: "claude-opus-4-1", isDefault: true, defaultReasoningEffort: "medium" },
            { model: "claude-sonnet-4-5", isDefault: false, defaultReasoningEffort: "medium" },
          ],
        }),
        list: async () => [],
      },
    },
  });
  await plugin(bb);
  const settings = await harness.callRpc("getFlowSettings", {});
  await harness.callRpc("saveFlowSettings", addFlow(settings as never, { ...newFlow("boundary", "Boundary"), stages }));
  await harness.callRpc("setFlowChoice", { projectId: "proj_a", flowId: "boundary" });
  await harness.emitThreadEvent("thread.created", { thread: makeThreadResponse({ id: THREAD, projectId: "proj_a", parentThreadId: null }) });
  // Утверждённая модель этапа — как её записал ответ на Выбор этапов.
  if (options.approved !== undefined) await bb.storage.kv.set(`flow-progress:${THREAD}`, { stages: Object.fromEntries(Object.entries(options.approved).map(([id, model]) => [id, { model }])), waiting: [] });
  const mark = async (id: string, state: "started" | "done") => {
    const answer = (await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: id, state }, { threadId: THREAD })) as { content: Array<{ text: string }> } | string;
    return typeof answer === "string" ? answer : answer.content.map((part) => part.text).join("");
  };
  return { mark, calls, sent };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

const SONNET = { providerId: "claude-code", model: "claude-sonnet-4-5", reasoningLevel: "high" as const };

describe("вход сервера: утверждённая модель доезжает до границы", () => {
  it("замер контекста и модель треда читаются из bb: сжатие, утверждённая модель с effort, потом реплика «продолжай» в очередь", async () => {
    const { mark, calls, sent } = await boot([stage("review", { name: "Review" }), stage("implement", { skill: "code-standards-fp", name: "Implementation" })], { used: 200_000, model: "claude-opus-4-1", approved: { implement: SONNET } });
    await mark("review", "started");
    expect(await mark("review", "done")).toContain("End your turn now: Flow compacts the thread, sets the model of stage implement");
    await settle();
    expect(calls).toEqual(["wait", "compact", "update:claude-sonnet-4-5/high", "send:queue-if-active"]);
    expect(sent[0]).toContain('carry on with stage implement "Implementation"');
  });

  it("этап без утверждённой модели модель треда не меняет, даже если это реализация", async () => {
    const { mark, calls } = await boot([stage("review", { name: "Review" }), stage("implement", { skill: "code-standards-fp", name: "Implementation" })], { used: 100_000, model: "claude-opus-4-1" });
    await mark("review", "started");
    expect(await mark("review", "done")).toBe("Stage review marked done.");
    await settle();
    expect(calls).toEqual([]);
  });

  it("контекст ниже порога и модель та же — ответ прежний, тред не трогают", async () => {
    const { mark, calls } = await boot([stage("review", { name: "Review" }), stage("plan", { name: "Plan" })], { used: 100_000, model: "claude-opus-4-1" });
    await mark("review", "started");
    expect(await mark("review", "done")).toBe("Stage review marked done.");
    await settle();
    expect(calls).toEqual([]);
  });

  it("впереди автоматизация: сжатие и модель идут перед будящей репликой Flow", async () => {
    const { mark, calls, sent } = await boot([stage("review", { name: "Review" }), archive, stage("implement", { skill: "code-standards-fp", name: "Implementation" })], { used: 200_000, model: "claude-opus-4-1", approved: { implement: SONNET } });
    await mark("review", "started");
    const answer = await mark("review", "done");
    await settle();
    expect(answer).toContain("Before the message that wakes you, Flow compacts the thread and sets the model of stage implement");
    expect(calls.indexOf("compact")).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf("compact")).toBeLessThan(calls.indexOf("update:claude-sonnet-4-5/high"));
    expect(calls.indexOf("update:claude-sonnet-4-5/high")).toBeLessThan(calls.findIndex((call) => call.startsWith("send")));
    expect(sent.join("\n")).toContain("implement");
  });
});
