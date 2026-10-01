// @vitest-environment node
import { createFakePluginHost, makeMessageDispatchHookContext } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { NO_FLOW } from "../core/flows";
import { isRunFinished } from "../core/run-summary";
import { stage } from "../core/stages-fixtures";
import { registerFlowChoice } from "./flow-choice";
import { createFlowSettings } from "./flow-settings";
import { registerNextRun } from "./next-run";
import { createProgress } from "./progress";
import { createStore } from "./store";
import { createThreadFlows } from "./thread-flows";

const THREAD = "thr_after";
const AT = "2026-10-01T10:00:00.000Z";
const STAGES = [stage("questions")];

const host = async (options: { held?: boolean } = {}) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow", sdk: { threads: { queuedMessages: { list: async () => [] } } } });
  const flows = await createFlowSettings(bb.storage.kv);
  const base = flows.current();
  await flows.save({ ...base, flows: [...base.flows, { ...base.flows[0]!, id: "flow-bug", name: "Bug" }] });
  const threads = await createThreadFlows(bb.storage.kv);
  const progress = createProgress(bb.storage.kv);
  const finished = async (threadId: string) => {
    const found = await progress.get(threadId);
    return found !== null && isRunFinished(found, STAGES);
  };
  const held = async () => options.held ?? false;
  const choice = registerFlowChoice(bb, { flows, threads, progress, store: createStore(bb.storage.kv), cancelRun: () => undefined, finished, held });
  registerNextRun(bb, { flows, threads, progress, finished, heldReason: () => "Каким flow идти дальше?", ownSend: () => false, ownerTurn: choice.ownerTurn });
  await threads.assign(THREAD, base.flows[0]!.id);
  // Прогон треда завершён: единственный этап закрыт.
  await progress.update(THREAD, () => ({ stages: { questions: { startedAt: AT, finishedAt: AT } }, waiting: [] }));
  const decide = () => harness.registrations.hooks["message.dispatch"]!({ ...makeMessageDispatchHookContext({ thread: { id: THREAD } }), initiator: "user" } as never);
  return { harness, threads, progress, decide };
};

describe("строка выбора flow после завершённого прогона", () => {
  it("flow у треда нет — выбранным стоит «Flow не выбран»", async () => {
    const { harness } = await host();
    expect(await harness.callRpc("threadFlowChoice", { threadId: THREAD })).toMatchObject({ selected: NO_FLOW, held: false });
  });

  it("сообщение, придержанное до выбора flow, видно строке", async () => {
    const { harness } = await host({ held: true });
    expect(await harness.callRpc("threadFlowChoice", { threadId: THREAD })).toMatchObject({ held: true });
  });

  it("выбор в строке — сообщение владельца не придерживается, тред идёт новым flow с новой записью прогона", async () => {
    const { harness, threads, progress, decide } = await host();
    await harness.callRpc("pickThreadFlow", { threadId: THREAD, flowId: "flow-bug" });
    expect(await decide()).toEqual({ action: "proceed" });
    expect(threads.flowOf(THREAD)).toBe("flow-bug");
    expect(await progress.get(THREAD)).toMatchObject({ stages: {}, waiting: [] });
  });

  it("без выбора сообщение придерживается, как раньше", async () => {
    const { decide } = await host();
    expect(await decide()).toEqual({ action: "wait", reason: "Каким flow идти дальше?" });
  });
});
