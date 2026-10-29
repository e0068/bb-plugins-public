// @vitest-environment node
//
// Ответ владельца снимает ожидание брифа — и центр закрывает карточку «Ждёт
// ответа»: сквозной путь через сам плагин Flow, RPC ответа и HTTP-вход
// центра. Журнал центра запись не теряет — он про отзыв ничего не знает.
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { addFlow, newFlow } from "./core/flows";
import { builtinStage } from "./lib/stage-constants";
import type { FlowSettings } from "./shared/contract";
import plugin from "./server";

afterEach(() => vi.unstubAllGlobals());

const PUSH = "/api/v1/plugins/notifications/http/push";
const RETRACT = "/api/v1/plugins/notifications/http/retract";

/** Центр в памяти: записанное им — что принял и что отозвали. */
const stubCenter = () => {
  const pushed: Array<Record<string, unknown>> = [];
  const retracted: unknown[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (String(url).endsWith(PUSH)) pushed.push(JSON.parse(String(init?.body)));
    else if (String(url).endsWith(RETRACT)) retracted.push(JSON.parse(String(init?.body)));
    else return new Response("{}", { status: 404 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  return { pushed, retracted };
};

/** Тред с Утверждением, ждущим владельца, и конец его хода: центр получил «Ждёт ответа». */
const awaitingBrief = async () => {
  const center = stubCenter();
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  await plugin(bb);
  const current = await harness.callRpc<FlowSettings>("getFlowSettings", {});
  await harness.callRpc("saveFlowSettings", addFlow(current, { ...newFlow("approve", "Approve"), stages: [builtinStage("approve", [])] }));
  await harness.callRpc("setFlowChoice", { projectId: "proj_ap", flowId: "approve" });
  await harness.emitThreadEvent("thread.created", { thread: makeThreadResponse({ id: "thr_ap", projectId: "proj_ap", parentThreadId: null }) });
  const outcome = { stage: "approve", final: false, next: "Дальше", done: ["Сделано"], pending: [], results: [{ label: "a.md", target: "a.md" }] };
  const reply = await harness.callAgentTool("ask_decision", { title: "Плагин", outcome }, { threadId: "thr_ap" });
  const briefId = /id="([^"]+)"/.exec(String(reply))?.[1] ?? "";
  await harness.emitThreadEvent("thread.idle", { thread: makeThreadResponse({ id: "thr_ap", title: "Тред" }), lastAssistantText: null });
  await vi.waitFor(() => expect(center.pushed.some((p) => p.kind === "awaiting")).toBe(true));
  return { harness, briefId, ...center };
};

describe("карточка «Ждёт ответа» и ответ на бриф", () => {
  it("ответ на бриф отзывает у центра ключ этого брифа", async () => {
    const { harness, briefId, pushed, retracted } = await awaitingBrief();
    expect(briefId).not.toBe("");
    const key = (pushed.find((p) => p.kind === "awaiting") as { dedupeKey: string }).dedupeKey;
    expect(retracted).toEqual([]);
    await harness.callRpc("answerBrief", { id: briefId, messageId: "m1", answer: { briefId, answers: [], place: "here", outcome: { accepted: true } } });
    await vi.waitFor(() => expect(retracted).toEqual([{ source: "flow", dedupeKey: key }]));
    expect(key).toBe(`brief:${briefId}`);
  });
});
