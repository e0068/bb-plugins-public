// @vitest-environment node
// Тумблер «Очищать контекст после автоматического выбора flow» на живом сервере Flow: тред с «Автоматически» в Claude Code
// и в своём дереве выбирает flow без ограничения навыков. Включён — агент просится закончить ход, и на конце хода контекст
// очищается, а задача уходит заново; выключен — ответ несёт этапы, и тред идёт дальше в той же сессии.
import { createFakePluginHost, makeMessageDispatchHookContext, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { addFlow, AUTO_FLOW, newFlow } from "./core/flows";
import { QUICK_STAGES } from "./core/stages-fixtures";
import { CHOOSE_FLOW_TOOL } from "./lib/stage-constants";
import { FRESH_SESSION_REPLY } from "./server/choose-flow";
import type { FlowSettings } from "./shared/contract";
import plugin from "./server";

const text = (result: unknown) => (typeof result === "string" ? result : JSON.stringify(result));
const flush = () => new Promise((resolve) => setTimeout(resolve, 50));

const setup = async (clearContextAfterAutoChoice?: boolean) => {
  const cleared: string[] = [];
  const sent: string[] = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: {
      threads: {
        get: async ({ threadId }: { threadId: string }) => ({ id: threadId, projectId: "proj_auto", environmentId: "env_1", status: "idle", providerId: "claude-code", title: "Тред" }),
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
  const withQuick = addFlow(current, { ...newFlow("quick", "Quick"), description: "Мелкие правки", stages: QUICK_STAGES });
  await harness.callRpc("saveFlowSettings", clearContextAfterAutoChoice === undefined ? withQuick : { ...withQuick, clearContextAfterAutoChoice });
  await harness.callRpc("setFlowChoice", { projectId: "proj_auto", flowId: AUTO_FLOW });
  const thread = makeThreadResponse({ id: "thr_auto", projectId: "proj_auto", parentThreadId: null, status: "pending" });
  await harness.emitThreadEvent("thread.created", { thread });
  await harness.registrations.hooks["message.dispatch"]!({ ...makeMessageDispatchHookContext({ thread }), initiator: "user" } as never);
  const choose = () => harness.callAgentTool(CHOOSE_FLOW_TOOL, { flowId: "quick" }, { threadId: "thr_auto" });
  const turnEnds = async () => {
    await harness.emitThreadEvent("thread.idle", { thread: makeThreadResponse({ id: "thr_auto", projectId: "proj_auto", parentThreadId: null }) });
    await flush();
  };
  return { choose, turnEnds, cleared, sent };
};

describe("тумблер очистки контекста после автоматического выбора flow", () => {
  it("нет поля — включён: выбор flow без ограничений просит закончить ход, и тред начинается заново", async () => {
    const { choose, turnEnds, cleared, sent } = await setup();
    expect(text(await choose())).toContain(FRESH_SESSION_REPLY);
    await turnEnds();
    expect(cleared).toEqual(["thr_auto"]);
    expect(sent).toContain("thr_auto");
  });

  it("выключен — ответ несёт этапы flow, и контекст не очищается", async () => {
    const { choose, turnEnds, cleared, sent } = await setup(false);
    const answer = text(await choose());
    expect(answer).not.toContain(FRESH_SESSION_REPLY);
    expect(answer).toMatch(/2\. implement/);
    await turnEnds();
    expect(cleared).toEqual([]);
    expect(sent).toEqual([]);
  });
});
