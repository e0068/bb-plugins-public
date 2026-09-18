// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { planner, report, stagedBrief } from "../core/stages-fixtures";
import { registerApi } from "./api";
import { createStore } from "./store";

describe("ответ на бриф с этапами", () => {
  it("этап старого брифа, ждавший приёмки, ответ не держит; перенос пишет исполнителя, выбранного владельцем", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow", sdk: { threads: { send: async () => ({ delivery: "started" }) } } });
    const store = createStore(bb.storage.kv);
    const brief = stagedBrief([report("task"), report("spec", { state: "review", results: [{ label: "s.md", target: "s.md" }] }), report("plan")]);
    await store.putBrief(brief);
    registerApi(bb, store, { now: () => "2026-09-15T00:00:00.000Z" });
    const plan = { id: "plan", run: true, executor: planner.id, picked: ["executor" as const] };
    const done = await harness.callRpc("answerBrief", { id: brief.id, messageId: "m", answer: { briefId: brief.id, answers: [], stages: [plan] } });
    expect(done).toMatchObject({ kind: "accepted" });
    expect(await store.getThreadCarry(brief.threadId)).toEqual({ "stage:plan:executor": [planner.id] });
  });
});
