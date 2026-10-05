// @vitest-environment node
// Записи Flow в Центр уведомлений: конец хода в треде с flow уходит в центр
// по HTTP — «ждёт ответа», если тред держит бриф, иначе «ход закончен».
// Тред без flow и отсутствующий центр Flow не ломают.
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { addFlow, newFlow, NO_FLOW } from "./core/flows";
import { stage } from "./core/stages-fixtures";
import { FLOW_STAGE_TOOL } from "./server/progress";
import type { FlowSettings } from "./shared/contract";
import plugin from "./server";
import { priced } from "./server/priced-fixture";

afterEach(() => vi.unstubAllGlobals());

const PUSH = "/api/v1/plugins/notifications/http/push";

/** Центр в памяти: запросы к нему записываются, остальные адреса отвечают 404. */
const stubCenter = (status = 200) => {
  const pushed: unknown[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (!String(url).endsWith(PUSH)) return new Response("{}", { status: 404 });
    pushed.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ ok: true }), { status });
  });
  return pushed;
};

const STAGES = [{ id: "questions", state: "todo" }, { id: "criteria", state: "todo" }, { id: "select", state: "todo" }, { id: "demo", state: "todo" }];

const boot = async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  await plugin(bb);
  const idle = (id: string, title: string | null = "Тред") => harness.emitThreadEvent("thread.idle", { thread: makeThreadResponse({ id, title }), lastAssistantText: null });
  return { harness, idle };
};

describe("Flow → Центр уведомлений", () => {
  it("конец хода без брифа — «Ход закончен» с названием треда", async () => {
    const pushed = stubCenter();
    const { idle } = await boot();
    await idle("thr_1");
    await vi.waitFor(() => expect(pushed).toHaveLength(1));
    expect(pushed[0]).toMatchObject({ source: "flow", kind: "turn-done", title: "Ход закончен", threadId: "thr_1", threadTitle: "Тред" });
  });

  it("конец хода с брифом, ждущим владельца, — «Ждёт ответа» с названием брифа", async () => {
    const pushed = stubCenter();
    const { harness, idle } = await boot();
    await harness.callAgentTool("ask_decision", priced({ title: "Плагин", setup: { stages: STAGES }, questions: [{ id: "q", question: "Да?", kind: "confirm", options: [{ id: "yes", action: "Yes" }] }] }), { threadId: "thr_1" });
    await idle("thr_1");
    await vi.waitFor(() => expect(pushed.some((p) => (p as { kind: string }).kind === "awaiting")).toBe(true));
    expect(pushed.find((p) => (p as { kind: string }).kind === "awaiting")).toMatchObject({ title: "Ждёт ответа — бриф «Плагин»", threadId: "thr_1" });
  });

  it("тред без flow в центр не пишет", async () => {
    const pushed = stubCenter();
    const { harness, idle } = await boot();
    await harness.callRpc("setFlowChoice", { projectId: "proj_none", flowId: NO_FLOW });
    await harness.emitThreadEvent("thread.created", { thread: makeThreadResponse({ id: "thr_none", projectId: "proj_none", parentThreadId: null }) });
    await idle("thr_none");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(pushed).toEqual([]);
  });

  it("центра нет — конец хода проходит без ошибок", async () => {
    stubCenter(404);
    const { idle } = await boot();
    expect((await idle("thr_1")).errors).toEqual([]);
  });
});

describe("итог автоматизации → Центр уведомлений", () => {
  const RUN = "/api/v1/plugins/automations-builder/http/run";

  /** Flow с этапом навыка и автоматизацией Automations за ним; Automations отвечает `answer`, центр пишет присланное. */
  const bootWithAutomation = async (answer: { executed: string[]; skipped: null; error: string | null }) => {
    const pushed: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (String(url).endsWith(PUSH)) {
        pushed.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (String(url).endsWith(RUN)) return new Response(JSON.stringify(answer), { status: 200 });
      return new Response("{}", { status: 404 });
    });
    const { bb, harness } = createFakePluginHost({ pluginId: "flow", sdk: { threads: { get: async () => makeThreadResponse({ id: "thr_auto", title: "Тред с автоматизацией", status: "idle" }) } } });
    await plugin(bb);
    const current = await harness.callRpc<FlowSettings>("getFlowSettings", {});
    const stages = [stage("implement"), stage("merge", { skill: "", name: "Merge", automation: { id: "a1", name: "Merge" } })];
    // Автоповтор выключен: упавший шаг сразу ждёт владельца.
    await harness.callRpc("saveFlowSettings", addFlow({ ...current, retryInSeconds: 0 }, { ...newFlow("with-automation", "With automation"), stages }));
    await harness.callRpc("setFlowChoice", { projectId: "proj_auto", flowId: "with-automation" });
    await harness.emitThreadEvent("thread.created", { thread: makeThreadResponse({ id: "thr_auto", projectId: "proj_auto", parentThreadId: null }) });
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "implement", state: "started" }, { threadId: "thr_auto" });
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "implement", state: "done" }, { threadId: "thr_auto" });
    return pushed;
  };

  it("доигранная автоматизация остаётся в центре записью «прошла» своего треда", async () => {
    const pushed = await bootWithAutomation({ executed: ["git.merge"], skipped: null, error: null });
    await vi.waitFor(() => expect(pushed.some((p) => p.kind === "automation-done")).toBe(true));
    expect(pushed.find((p) => p.kind === "automation-done")).toMatchObject({ source: "flow", title: "Автоматизация «Merge» прошла", threadId: "thr_auto", threadTitle: "Тред с автоматизацией", dedupeKey: expect.stringMatching(/^automation:/) });
  });

  it("упавшая автоматизация остаётся в центре записью «упала»", async () => {
    const pushed = await bootWithAutomation({ executed: [], skipped: null, error: "merge conflict" });
    await vi.waitFor(() => expect(pushed.some((p) => p.kind === "automation-failed")).toBe(true));
    expect(pushed.find((p) => p.kind === "automation-failed")).toMatchObject({ threadId: "thr_auto", title: expect.stringMatching(/^Автоматизация «Merge» упала на шаге/) });
  });
});
