// @vitest-environment node
// Следующий прогон с «Автоматически»: форма над композером отпускает сообщение, и агент
// нового прогона получает то же правило выбора flow, что и новый тред с «Автоматически».
import { createFakePluginHost, makeQueueEntry, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { AUTO_FLOW } from "./core/flows";
import { CHOOSE_FLOW_TOOL } from "./lib/stage-constants";
import plugin from "./server";

const THREAD = "thr_next_auto";

describe("«Автоматически» в выборе flow следующего прогона", () => {
  it("агент следующего прогона получает правило выбора flow и выбирает его инструментом", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "flow",
      sdk: { threads: { queuedMessages: { list: async () => [makeQueueEntry({ threadId: THREAD, waitingOn: { kind: "plugin", pluginId: "flow", reason: "held" } })] } } },
    });
    await plugin(bb);
    await harness.emitThreadEvent("thread.created", { thread: makeThreadResponse({ id: THREAD, projectId: "proj", parentThreadId: null }) });
    const instructions = () => harness.registrations.instructionProvider?.({ threadId: THREAD, projectId: "proj" }) ?? "";

    expect(await harness.callRpc("startNextRun", { threadId: THREAD, flowId: AUTO_FLOW, compact: false })).toEqual({ kind: "sent" });
    expect(instructions()).toContain(CHOOSE_FLOW_TOOL);
    expect(await harness.callAgentTool(CHOOSE_FLOW_TOOL, { flowId: "none" }, { threadId: THREAD })).not.toMatchObject({ isError: true });
  });
});
