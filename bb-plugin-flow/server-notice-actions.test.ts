// @vitest-environment node
// Кнопки тоста центра «Повторить» и «Пропустить» приходят во Flow HTTP-входом
// notification-action: вход зовёт тот же повтор и пропуск, что кнопки полосы
// прогона, и отвечает центру, что показать владельцу. Итог автоматизации Flow
// больше не шлёт в свой канал realtime: тост показывает центр по записи.
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { isNotificationInput } from "@bb-plugins/notifications-contract/index";
import { afterEach, describe, expect, it, vi } from "vitest";

import { addFlow, newFlow } from "./core/flows";
import { NOTICE_ACTION_PATH } from "./core/center-notice";
import { stage } from "./core/stages-fixtures";
import { ru } from "./lib/messages/ru";
import { FLOW_STAGE_TOOL } from "./server/progress";
import type { FlowSettings } from "./shared/contract";
import plugin from "./server";
import { registerNoticeActions } from "./server/center";

afterEach(() => vi.unstubAllGlobals());

const PUSH = "/api/v1/plugins/notifications/http/push";
const RUN = "/api/v1/plugins/automations-builder/http/run";

/** Flow, у которого автоматизация Merge упала и ждёт владельца; Automations отвечает по очереди `answers`. */
const bootFailed = async (answers: Array<{ executed: string[]; skipped: null; error: string | null }>) => {
  const pushed: Array<Record<string, unknown>> = [];
  let runs = 0;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (String(url).endsWith(PUSH)) {
      pushed.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (String(url).endsWith(RUN)) return new Response(JSON.stringify(answers[Math.min(runs++, answers.length - 1)]), { status: 200 });
    return new Response("{}", { status: 404 });
  });
  const { bb, harness } = createFakePluginHost({ pluginId: "flow", sdk: { threads: { get: async () => makeThreadResponse({ id: "thr_auto", title: "Тред", status: "idle" }) } } });
  await plugin(bb);
  const current = await harness.callRpc<FlowSettings>("getFlowSettings", {});
  const stages = [stage("implement"), stage("merge", { skill: "", name: "Merge", automation: { id: "a1", name: "Merge" } })];
  await harness.callRpc("saveFlowSettings", addFlow(current, { ...newFlow("with-automation", "With automation"), stages }));
  await harness.callRpc("setFlowChoice", { projectId: "proj_auto", flowId: "with-automation" });
  await harness.emitThreadEvent("thread.created", { thread: makeThreadResponse({ id: "thr_auto", projectId: "proj_auto", parentThreadId: null }) });
  await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "implement", state: "started" }, { threadId: "thr_auto" });
  await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "implement", state: "done" }, { threadId: "thr_auto" });
  await vi.waitFor(() => expect(pushed.some((p) => p.kind === "automation-failed")).toBe(true));
  return { harness, pushed, runs: () => runs };
};

const press = (harness: Awaited<ReturnType<typeof bootFailed>>["harness"], body: unknown) =>
  harness.fetchHttp("POST", NOTICE_ACTION_PATH, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const FAILED = { executed: [], skipped: null, error: "merge conflict" };
const DONE = { executed: ["git.merge"], skipped: null, error: null };

describe("итог автоматизации уходит центру, а не в свой тост", () => {
  it("запись упавшей автоматизации несёт карточку с «Повторить» и «Пропустить», канала тостов Flow нет", async () => {
    const { harness, pushed } = await bootFailed([FAILED]);
    const entry = pushed.find((p) => p.kind === "automation-failed")!;
    expect(isNotificationInput(entry)).toBe(true);
    const labels = (entry.toast as { actions: Array<{ label: string }> }).actions.map((a) => a.label);
    expect(labels).toEqual([ru.notice.retry, ru.notice.skip, ru.notice.toThread]);
    expect(harness.realtimeSignals.map((s) => s.channel)).not.toContain("flow:automation-notice");
  });
});

describe("вход notification-action", () => {
  it("«Повторить» на ждущем шаге повторяет его и молчит", async () => {
    const { harness, pushed, runs } = await bootFailed([FAILED, DONE]);
    const response = await press(harness, { action: "retry", threadId: "thr_auto", stage: "merge", stageName: "Merge" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: null });
    await vi.waitFor(() => expect(pushed.some((p) => p.kind === "automation-done")).toBe(true));
    expect(runs()).toBe(2);
  });

  it("«Пропустить» на ждущем шаге пропускает его и молчит", async () => {
    const { harness } = await bootFailed([FAILED]);
    const response = await press(harness, { action: "skip", threadId: "thr_auto", stage: "merge", stageName: "Merge" });
    expect(await response.json()).toEqual({ message: null });
  });

  it("этап не ждёт владельца — ответ словами полосы прогона «уже не ждёт»", async () => {
    const { harness } = await bootFailed([FAILED]);
    const response = await press(harness, { action: "retry", threadId: "thr_auto", stage: "implement", stageName: "Implement" });
    expect(await response.json()).toEqual({ message: ru.notice.notWaiting("Implement") });
  });

  it("Flow ещё ведёт этап после первого нажатия — второе отвечает «Flow сейчас ведёт этап»", async () => {
    const { harness } = await bootFailed([FAILED, DONE]);
    await press(harness, { action: "skip", threadId: "thr_auto", stage: "merge", stageName: "Merge" });
    const again = await press(harness, { action: "retry", threadId: "thr_auto", stage: "merge", stageName: "Merge" });
    expect(await again.json()).toEqual({ message: ru.notice.busy("Merge") });
  });

  it("тело не той формы — 400", async () => {
    const { harness } = await bootFailed([FAILED]);
    expect((await press(harness, { action: "restart", threadId: "thr_auto", stage: "merge", stageName: "Merge" })).status).toBe(400);
    expect((await press(harness, { action: "retry", threadId: "", stage: "merge", stageName: "Merge" })).status).toBe(400);
    expect((await harness.fetchHttp("POST", NOTICE_ACTION_PATH, { method: "POST", body: "не json" })).status).toBe(400);
  });
});

describe("вход notification-action — сбой исполнителя", () => {
  it("повтор бросил — центру уходит текст ошибки, а не падение входа", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    registerNoticeActions(bb, { retry: async () => Promise.reject(new Error("store is closed")), skip: async () => ({ started: true }) });
    const response = await harness.fetchHttp("POST", NOTICE_ACTION_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "retry", threadId: "thr_1", stage: "merge", stageName: "Merge" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: "store is closed" });
  });
});
