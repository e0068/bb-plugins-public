// @vitest-environment node
// Side chat — тред плагина side-chat, корневой, в том же проекте и дереве, что основной. Flow его не ведёт: ни flow,
// ни прогона, ни выбора над композером — и тред, получивший flow до этой версии, теряет его на первом же ходе.
import { createFakePluginHost, makeMessageDispatchHookContext, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { addFlow, newFlow } from "./core/flows";
import { QUICK_STAGES } from "./core/stages-fixtures";
import type { FlowSettings } from "./shared/contract";
import plugin from "./server";

const PROJECT = "proj_side";
const SIDE = "thr_side";

const setup = async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: {
      threads: {
        get: async ({ threadId }: { threadId: string }) =>
          makeThreadResponse({ id: threadId, projectId: PROJECT, parentThreadId: null, status: "idle", originPluginId: threadId === SIDE ? "side-chat" : null }),
      },
    },
  });
  await plugin(bb);
  const current = await harness.callRpc<FlowSettings>("getFlowSettings", {});
  await harness.callRpc("saveFlowSettings", addFlow(current, { ...newFlow("quick", "Quick"), stages: QUICK_STAGES }));
  await harness.callRpc("setFlowChoice", { projectId: PROJECT, flowId: "quick" });
  const send = (originPluginId: string | null, status: "pending" | "idle") =>
    harness.registrations.hooks["message.dispatch"]!({ ...makeMessageDispatchHookContext({ thread: { id: SIDE, projectId: PROJECT, parentThreadId: null, status, originPluginId }, attempt: "start-turn" }), initiator: "user" } as never);
  const state = async () => ({
    flow: await harness.callRpc<{ flowId: string | null }>("threadFlow", { threadId: SIDE }),
    progress: await harness.callRpc("getFlowProgress", { threadId: SIDE }),
    choice: await harness.callRpc("threadFlowChoice", { threadId: SIDE }),
    instructions: harness.registrations.instructionProvider?.({ threadId: SIDE, projectId: PROJECT }) ?? "",
  });
  return { harness, send, state };
};

describe("Side chat без Flow", () => {
  it("новый Side chat в проекте с выбранным flow не получает ни flow, ни прогона, ни выбора, ни правил Flow", async () => {
    const { harness, send, state } = await setup();
    await harness.emitThreadEvent("thread.created", { thread: makeThreadResponse({ id: SIDE, projectId: PROJECT, parentThreadId: null, status: "pending", originPluginId: "side-chat" }) });
    await send("side-chat", "pending");
    expect(await state()).toEqual({ flow: { flowId: null }, progress: null, choice: null, instructions: "" });
  });

  it("Side chat, получивший flow и прогон до этой версии, теряет их на первом же ходе", async () => {
    const { send, state } = await setup();
    // До этой версии Flow не узнавал Side chat: тред получал flow проекта и пустой прогон.
    await send(null, "pending");
    expect((await state()).progress).not.toBeNull();
    await send("side-chat", "idle");
    expect(await state()).toEqual({ flow: { flowId: null }, progress: null, choice: null, instructions: "" });
  });
});
