// @vitest-environment node
import { createFakePluginHost, makeMessageDispatchHookContext } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { AUTO_FLOW } from "../core/flows";
import { isRunFinished } from "../core/run-summary";
import { stage } from "../core/stages-fixtures";
import { registerFlowChoice } from "./flow-choice";
import { createFlowSettings } from "./flow-settings";
import { CHOOSING_REASON, registerOwnerTurn } from "./owner-turn";
import { createProgress } from "./progress";
import { createStore } from "./store";
import { createThreadFlows } from "./thread-flows";

const THREAD = "thr_after";
const AT = "2026-10-01T10:00:00.000Z";
const STAGES = [stage("questions")];

const host = async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const flows = await createFlowSettings(bb.storage.kv);
  const base = flows.current();
  await flows.save({ ...base, flows: [...base.flows, { ...base.flows[0]!, id: "flow-bug", name: "Bug" }] });
  const threads = await createThreadFlows(bb.storage.kv);
  const progress = createProgress(bb.storage.kv);
  const finished = async (threadId: string) => {
    const found = await progress.get(threadId);
    return found !== null && isRunFinished(found, STAGES);
  };
  const choice = registerFlowChoice(bb, { flows, threads, progress, store: createStore(bb.storage.kv), cancelRun: () => undefined, finished });
  // Выбор flow до хода — заглушка: ждёт, пока тред на «Автоматически», и помнит, на каком прогоне её спросили.
  const gated: Array<unknown> = [];
  const autoChoice = { gate: (threadId: string) => (threads.flowOf(threadId) === AUTO_FLOW ? (gated.push(progress.get(threadId)), "wait" as const) : ("proceed" as const)) };
  registerOwnerTurn(bb, { ownSend: () => false, ownerTurn: choice.ownerTurn, autoChoice });
  await threads.assign(THREAD, base.flows[0]!.id);
  // Прогон треда завершён: единственный этап закрыт.
  await progress.update(THREAD, () => ({ stages: { questions: { startedAt: AT, finishedAt: AT } }, waiting: [] }));
  const decide = () => harness.registrations.hooks["message.dispatch"]!({ ...makeMessageDispatchHookContext({ thread: { id: THREAD } }), initiator: "user" } as never);
  return { harness, threads, progress, decide, gated };
};

describe("сообщение владельца после завершённого прогона", () => {
  it("контейнер состояния Flow предлагает «Автоматически»", async () => {
    const { harness } = await host();
    expect(await harness.callRpc("threadFlowChoice", { threadId: THREAD })).toMatchObject({ selected: AUTO_FLOW });
  });

  it("без выбора тред встаёт на «Автоматически», завершённый прогон снимается, и сообщение ждёт выбора flow", async () => {
    const { threads, progress, decide, gated } = await host();
    expect(await decide()).toEqual({ action: "wait", reason: CHOOSING_REASON });
    expect(threads.flowOf(THREAD)).toBe(AUTO_FLOW);
    expect(await progress.get(THREAD)).toBeNull();
    expect(await gated[0]).toBeNull();
  });

  it("с выбором сообщение уходит сразу, и тред идёт выбранным flow с новой записью прогона", async () => {
    const { harness, threads, progress, decide } = await host();
    await harness.callRpc("pickThreadFlow", { threadId: THREAD, flowId: "flow-bug" });
    expect(await decide()).toEqual({ action: "proceed" });
    expect(threads.flowOf(THREAD)).toBe("flow-bug");
    expect(await progress.get(THREAD)).toMatchObject({ stages: {}, waiting: [] });
  });
});
