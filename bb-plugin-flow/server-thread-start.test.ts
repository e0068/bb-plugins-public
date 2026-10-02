// @vitest-environment node
// Flow цепляется к треду с его первым сообщением — раньше инструкций первого хода: тред, который Flow создал
// передачей работы, получает flow исходного треда и его прогон, новый тред с настоящим flow — пустой прогон.
import { createFakePluginHost, makeMessageDispatchHookContext, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { addFlow, AUTO_FLOW, newFlow } from "./core/flows";
import { QUICK_STAGES } from "./core/stages-fixtures";
import { ASK_TOOL_NAME } from "./server/ask-tool";
import { CHOOSE_FLOW_TOOL } from "./lib/stage-constants";
import type { FlowSettings, ProgressView } from "./shared/contract";
import plugin from "./server";

type Input = Array<{ type: string; text?: string; mentions?: unknown[] }>;

/** Бриф по правилам инструмента: объём, пункт «Готово, когда» с ценой и доля у каждого этапа навыка. */
const briefArgs = (stages: ReadonlyArray<{ id: string; recommended: boolean }>) => ({
  title: "Бриф",
  scope: "- передать работу",
  setup: {
    criteria: [{ text: "Работа передана", add: { target: 1, max: 2, risk: 0, minutes: 5 } }],
    stages: stages.map((stage) => ({ ...stage, state: "todo", share: { percent: 100, risk: 0 } })),
  },
});

const setup = async (options: { hooked?: boolean; eventLast?: boolean } = {}) => {
  let created = 0;
  const instructionsAtFirstTurn: string[] = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: {
      threads: {
        get: async ({ threadId }: { threadId: string }) => ({ id: threadId, projectId: "proj_quick", environmentId: "env_1", status: "idle", providerId: "claude", title: "Исходный тред" }),
        send: async () => ({ delivery: "started" }),
        // Как bb 0.44: ссылка на исходный тред — только у форка; первое сообщение решается хуком внутри создания, до ответа с id.
        spawn: async (args: { projectId: string; input: Input; sourceThreadId?: string; originKind?: string }) => {
          if (args.sourceThreadId !== undefined && args.originKind === undefined) throw new Error("sourceThreadId requires an originKind");
          const id = `thr_spawned_${++created}`;
          const thread = makeThreadResponse({ id, projectId: args.projectId, parentThreadId: null, status: "pending", originPluginId: "flow" });
          // bb не обещает, что событие создания придёт раньше хука первого сообщения: оно уходит отложенным.
          if (options.eventLast !== true) await harness.emitThreadEvent("thread.created", { thread });
          const text = args.input.flatMap((block) => (block.type === "text" ? [block.text ?? ""] : [])).join("\n");
          if (options.hooked !== false) await harness.registrations.hooks["message.dispatch"]!({ ...makeMessageDispatchHookContext({ thread, input: { blocks: args.input as never, text } }), initiator: "user" } as never);
          if (options.eventLast === true) await harness.emitThreadEvent("thread.created", { thread });
          instructionsAtFirstTurn.push(harness.registrations.instructionProvider?.({ threadId: id, projectId: args.projectId }) ?? "");
          return { id };
        },
      },
      environments: { get: async () => ({ hostId: "host_1", path: "/tree", branchName: "bb/thr_src" }) },
    },
  });
  await plugin(bb);
  const current = await harness.callRpc<FlowSettings>("getFlowSettings", {});
  await harness.callRpc("saveFlowSettings", addFlow(current, { ...newFlow("quick", "Quick"), stages: QUICK_STAGES }));
  /** Тред из композера: создан, и его первое сообщение уходит владельцем. */
  const composerThread = async (id: string, projectId: string) => {
    const thread = makeThreadResponse({ id, projectId, parentThreadId: null, status: "pending" });
    if (options.eventLast !== true) await harness.emitThreadEvent("thread.created", { thread });
    await harness.registrations.hooks["message.dispatch"]!({ ...makeMessageDispatchHookContext({ thread }), initiator: "user" } as never);
    if (options.eventLast === true) await harness.emitThreadEvent("thread.created", { thread });
  };
  const view = (threadId: string) => harness.callRpc<ProgressView | null>("getFlowProgress", { threadId });
  return { harness, composerThread, view, instructionsAtFirstTurn };
};

describe("flow и прогон треда с первого сообщения", () => {
  it("новый тред проекта с flow сразу получает пустой прогон этого flow", async () => {
    const { harness, composerThread, view } = await setup();
    await harness.callRpc("setFlowChoice", { projectId: "proj_quick", flowId: "quick" });
    await composerThread("thr_new", "proj_quick");
    expect(await view("thr_new")).toMatchObject({ done: 0, total: QUICK_STAGES.length, flowName: "Quick" });
  });

  it("тред проекта с «Автоматически» прогона не получает, пока агент не выбрал flow, а выбор сразу заводит прогон", async () => {
    const { harness, composerThread, view } = await setup();
    await harness.callRpc("setFlowChoice", { projectId: "proj_auto", flowId: AUTO_FLOW });
    await composerThread("thr_auto", "proj_auto");
    expect(await view("thr_auto")).toBeNull();
    await harness.callAgentTool(CHOOSE_FLOW_TOOL, { flowId: "quick" }, { threadId: "thr_auto" });
    expect(await view("thr_auto")).toMatchObject({ done: 0, flowName: "Quick" });
  });

  it("передача работы: новый тред идёт flow исходного уже в первом ходе и ведёт его прогон без снятого в брифе этапа", async () => {
    const { harness, composerThread, view, instructionsAtFirstTurn } = await setup();
    await harness.callRpc("setFlowChoice", { projectId: "proj_quick", flowId: "quick" });
    await composerThread("thr_src", "proj_quick");
    const [first, second] = QUICK_STAGES;
    const asked = JSON.stringify(await harness.callAgentTool(ASK_TOOL_NAME, briefArgs([{ id: first!.id, recommended: true }, { id: second!.id, recommended: true }]), { threadId: "thr_src" }));
    const briefId = /dec_[a-z0-9]+/.exec(asked)![0];
    // Проект к моменту передачи стоит на «Автоматически» — новый тред всё равно получает flow исходного.
    await harness.callRpc("setFlowChoice", { projectId: "proj_quick", flowId: AUTO_FLOW });
    const stages = [{ id: first!.id, run: true, executor: "self" }, { id: second!.id, run: false, executor: "self" }];
    await harness.callRpc("answerBrief", { id: briefId, messageId: "m", answer: { briefId, answers: [], place: "thread", stages } });
    expect(instructionsAtFirstTurn[0]).not.toContain(CHOOSE_FLOW_TOOL);
    const next = await view("thr_spawned_1");
    expect(next).toMatchObject({ flowName: "Quick" });
    expect(next?.stages.find((stage) => stage.id === second!.id)?.state).toBe("skip");
    expect((await view("thr_src"))?.carrier).toMatchObject({ threadId: "thr_spawned_1" });
  });

  it("первое сообщение передачи прошло мимо хука — flow исходного тред всё равно получает с передачей прогона", async () => {
    const { harness, composerThread, view } = await setup({ hooked: false });
    await harness.callRpc("setFlowChoice", { projectId: "proj_quick", flowId: "quick" });
    await composerThread("thr_src", "proj_quick");
    const asked = JSON.stringify(await harness.callAgentTool(ASK_TOOL_NAME, briefArgs(QUICK_STAGES.map((stage) => ({ id: stage.id, recommended: true }))), { threadId: "thr_src" }));
    const briefId = /dec_[a-z0-9]+/.exec(asked)![0];
    await harness.callRpc("setFlowChoice", { projectId: "proj_quick", flowId: AUTO_FLOW });
    await harness.callRpc("answerBrief", { id: briefId, messageId: "m", answer: { briefId, answers: [], place: "thread", stages: QUICK_STAGES.map((stage) => ({ id: stage.id, run: true, executor: "self" })) } });
    expect(harness.registrations.instructionProvider?.({ threadId: "thr_spawned_1", projectId: "proj_quick" })).not.toContain(CHOOSE_FLOW_TOOL);
    expect(await view("thr_spawned_1")).toMatchObject({ flowName: "Quick" });
  });

  it("событие создания пришло после первого сообщения — тред передачи всё равно идёт flow исходного уже в первом ходе", async () => {
    const { harness, composerThread, view, instructionsAtFirstTurn } = await setup({ eventLast: true });
    await harness.callRpc("setFlowChoice", { projectId: "proj_quick", flowId: "quick" });
    await composerThread("thr_src", "proj_quick");
    expect(await view("thr_src")).toMatchObject({ flowName: "Quick", done: 0 });
    const asked = JSON.stringify(await harness.callAgentTool(ASK_TOOL_NAME, briefArgs(QUICK_STAGES.map((stage) => ({ id: stage.id, recommended: true }))), { threadId: "thr_src" }));
    const briefId = /dec_[a-z0-9]+/.exec(asked)![0];
    await harness.callRpc("setFlowChoice", { projectId: "proj_quick", flowId: AUTO_FLOW });
    await harness.callRpc("answerBrief", { id: briefId, messageId: "m", answer: { briefId, answers: [], place: "thread", stages: QUICK_STAGES.map((stage) => ({ id: stage.id, run: true, executor: "self" })) } });
    expect(instructionsAtFirstTurn[0]).not.toContain(CHOOSE_FLOW_TOOL);
  });

  it("событие создания пришло после первого сообщения — тред проекта на «Автоматически» чужого прогона не получает", async () => {
    const { harness, composerThread, view } = await setup({ eventLast: true });
    await harness.callRpc("setFlowChoice", { projectId: "proj_auto", flowId: AUTO_FLOW });
    await composerThread("thr_auto", "proj_auto");
    expect(await view("thr_auto")).toBeNull();
  });
});
