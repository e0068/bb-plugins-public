// @vitest-environment node
// Переход из ответа в другой flow целиком через плагин: агент рекомендует flow в Демонстрации, владелец отправляет её
// с выбранным flow — тред (или новый тред) встаёт на этот flow с пустым прогоном, а автоматизации за Демонстрацией не идут.
import { createFakePluginHost, makeMessageDispatchHookContext, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { addFlow, newFlow } from "./core/flows";
import { QUICK_STAGES, stage } from "./core/stages-fixtures";
import { ASK_TOOL_NAME } from "./server/ask-tool";
import type { FlowSettings, ProgressView, WorkStage } from "./shared/contract";
import plugin from "./server";

type Input = Array<{ type: string; text?: string }>;

/** Flow ответа: этап-навык, Демонстрация и архив треда за ней. */
const ANSWER_STAGES: WorkStage[] = [
  stage("project", { skill: "project-docs", name: "Project" }),
  { id: "demo", kind: "demo", skill: "", name: "Demonstration", executors: [] },
  { id: "archive", kind: "skill", skill: "", name: "Archive", executors: [], automation: { source: "flow", steps: ["bb.archive"] } },
];

const setup = async () => {
  let created = 0;
  const archived: string[] = [];
  const sent: Array<{ threadId: string; text: string }> = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: {
      threads: {
        get: async ({ threadId }: { threadId: string }) => ({ id: threadId, projectId: "proj_1", environmentId: "env_1", status: "idle", providerId: "claude", title: "Ответ" }),
        send: async (args: { threadId: string; input: Input }) => {
          sent.push({ threadId: args.threadId, text: args.input.map((part) => part.text ?? "").join("") });
          return { delivery: "started" };
        },
        archive: async ({ threadId }: { threadId: string }) => void archived.push(threadId),
        spawn: async (args: { projectId: string; input: Input }) => {
          const id = `thr_spawned_${++created}`;
          const thread = makeThreadResponse({ id, projectId: args.projectId, parentThreadId: null, status: "pending", originPluginId: "flow" });
          await harness.emitThreadEvent("thread.created", { thread });
          const text = args.input.flatMap((block) => (block.type === "text" ? [block.text ?? ""] : [])).join("\n");
          await harness.registrations.hooks["message.dispatch"]!({ ...makeMessageDispatchHookContext({ thread, input: { blocks: args.input as never, text } }), initiator: "user" } as never);
          return { id };
        },
      },
      environments: { get: async () => ({ hostId: "host_1", path: "/tree", branchName: "bb/thr_src" }) },
    },
  });
  await plugin(bb);
  const current = await harness.callRpc<FlowSettings>("getFlowSettings", {});
  const withAnswer = addFlow(current, { ...newFlow("answer", "Answer"), stages: ANSWER_STAGES });
  await harness.callRpc("saveFlowSettings", addFlow(withAnswer, { ...newFlow("quick", "Quick"), stages: QUICK_STAGES }));
  await harness.callRpc("setFlowChoice", { projectId: "proj_1", flowId: "answer" });
  const thread = makeThreadResponse({ id: "thr_src", projectId: "proj_1", parentThreadId: null, status: "pending" });
  await harness.emitThreadEvent("thread.created", { thread });
  await harness.registrations.hooks["message.dispatch"]!({ ...makeMessageDispatchHookContext({ thread }), initiator: "user" } as never);

  const ask = async (args: unknown, threadId = "thr_src") => {
    const asked = JSON.stringify(await harness.callAgentTool(ASK_TOOL_NAME, args, { threadId }));
    return { asked, briefId: /dec_[a-z0-9]+/.exec(asked)?.[0] };
  };
  // Ответ запущен: этапы взяты в прогон — Демонстрация после этого принимается.
  const launch = await ask({
    title: "Ответ на вопрос",
    scope: "- ответить на вопрос",
    setup: {
      criteria: [{ text: "Ответ дан", add: { target: 1, max: 2, risk: 0, minutes: 5 } }],
      stages: [
        { id: "project", state: "todo", recommended: true, share: { percent: 100, risk: 0 } },
        { id: "demo", state: "todo", recommended: true },
        { id: "archive", state: "todo", recommended: true },
      ],
    },
  });
  await harness.callRpc("answerBrief", {
    id: launch.briefId,
    messageId: "m1",
    answer: { briefId: launch.briefId, answers: [], stages: ["project", "demo", "archive"].map((id) => ({ id, run: true, executor: "self" })) },
  });
  await harness.callAgentTool("flow_stage", { stage: "project", state: "started" }, { threadId: "thr_src" });
  await harness.callAgentTool("flow_stage", { stage: "project", state: "done" }, { threadId: "thr_src" });

  const demo = (nextFlow: string) =>
    ask({
      title: "Ответ",
      outcome: { stage: "demo", final: true, done: ["Ответ дан"], pending: [], results: [{ label: "a.md", target: "a.md" }], documentsOnly: true, nextFlow },
    });
  const view = (threadId: string) => harness.callRpc<ProgressView | null>("getFlowProgress", { threadId });
  const answerDemo = (briefId: string, place: "here" | "thread") =>
    harness.callRpc("answerBrief", { id: briefId, messageId: "m2", answer: { briefId, answers: [], place, outcome: { accepted: false, flow: { id: "quick", name: "Quick" } } } });
  /** Бриф без первой части: в запущенной работе он принимается, в новой — нет, у неё ещё нет объёма и критериев. */
  const bareBrief = (threadId: string) => ask({ title: "Вопрос", questions: [{ id: "q", kind: "confirm", question: "Так?", options: [{ id: "yes", action: "Yes" }] }] }, threadId);
  return { demo, view, answerDemo, archived, sent, bareBrief };
};

describe("переход из Демонстрации ответа в другой flow", () => {
  it("«в этом треде» ставит тред на выбранный flow с пустым прогоном, архив за Демонстрацией не идёт", async () => {
    const t = await setup();
    const { briefId } = await t.demo("quick");
    await t.answerDemo(briefId!, "here");
    expect(await t.view("thr_src")).toMatchObject({ flowName: "Quick", done: 0, total: QUICK_STAGES.length });
    expect(t.archived).toEqual([]);
    expect(t.sent.at(-1)).toMatchObject({ threadId: "thr_src" });
    expect(t.sent.at(-1)?.text).toContain("«Quick»");
  });

  it("новый flow начинается с чистого листа: запуск, критерии и объём ответа ему не достаются", async () => {
    const t = await setup();
    const { briefId } = await t.demo("quick");
    await t.answerDemo(briefId!, "here");
    const { asked } = await t.bareBrief("thr_src");
    expect(asked).toContain("scope is missing");
  });

  it("«в новом треде» отдаёт новому треду выбранный flow, а не flow ответа", async () => {
    const t = await setup();
    const { briefId } = await t.demo("quick");
    await t.answerDemo(briefId!, "thread");
    expect(await t.view("thr_spawned_1")).toMatchObject({ flowName: "Quick", done: 0 });
    expect(t.archived).toEqual([]);
  });

  it("«в новом треде» новый тред не считается запущенным, а прогон ответа в исходном снимается", async () => {
    const t = await setup();
    const { briefId } = await t.demo("quick");
    await t.answerDemo(briefId!, "thread");
    expect((await t.bareBrief("thr_spawned_1")).asked).toContain("scope is missing");
    expect(await t.view("thr_src")).toBeNull();
  });

  it("Демонстрацию с неизвестным flow инструмент не принимает и называет flow владельца", async () => {
    const t = await setup();
    const { asked, briefId } = await t.demo("no-such-flow");
    expect(briefId).toBeUndefined();
    expect(asked).toContain("no-such-flow");
    expect(asked).toContain("quick");
  });
});
