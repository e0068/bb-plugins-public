// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { stage } from "../core/stages-fixtures";
import { builtinStage } from "../lib/stage-constants";
import type { StageSettings } from "../shared/contract";
import { registerApi } from "./api";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createProgress, registerProgress } from "./progress";
import { createStore } from "./store";

const THREAD = "thr_context";
const settings: StageSettings = { stages: [builtinStage("questions", []), stage("task", { name: "Задача" })], minButtonWidth: 170 };

type Fill = { share: number; usedTokens: number; windowTokens: number; warnPercent: number; alertPercent: number };

const host = async (context?: () => Promise<Fill | null>) => {
  const now = () => "2026-09-23T10:00:00.000Z";
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  const progress = createProgress(bb.storage.kv);
  registerAskTool(bb, store, { newId: () => "run", now, stages: () => settings, progress });
  registerApi(bb, store, { now, progress });
  registerProgress(bb, progress, { now, stages: () => settings, windowCost: async () => undefined, ...(context === undefined ? {} : { context }) });
  // Баннер появляется только у треда с записью прогресса: без брифа отвечать нечем.
  await harness.callAgentTool(ASK_TOOL_NAME, { title: "Бриф", setup: { stages: [{ id: "questions", state: "todo" }, { id: "task", state: "todo", recommended: true }] } }, { threadId: THREAD });
  return harness;
};

const fill: Fill = { share: 0.181, usedTokens: 163_000, windowTokens: 900_000, warnPercent: 25, alertPercent: 40 };

describe("заполненность окна в ответе баннера", () => {
  it("числа есть — они едут тем же ответом, что и прогресс", async () => {
    const harness = await host(async () => fill);
    expect(await harness.callRpc("getFlowProgress", { threadId: THREAD })).toMatchObject({ context: fill });
  });

  it("пороги приезжают из ответа, а не подбираются фронтом", async () => {
    const harness = await host(async () => ({ ...fill, warnPercent: 12, alertPercent: 55 }));
    const view = (await harness.callRpc("getFlowProgress", { threadId: THREAD })) as { context: Fill };
    expect(view.context).toMatchObject({ warnPercent: 12, alertPercent: 55 });
  });

  it("чисел за тредом ещё нет — поля нет, а прогресс на месте", async () => {
    const harness = await host(async () => null);
    const view = (await harness.callRpc("getFlowProgress", { threadId: THREAD })) as Record<string, unknown>;
    expect(view.context).toBeUndefined();
    expect(view.total).toBe(2);
  });

  it("источник чисел не подключён — баннер работает как раньше", async () => {
    const harness = await host();
    const view = (await harness.callRpc("getFlowProgress", { threadId: THREAD })) as Record<string, unknown>;
    expect(view.context).toBeUndefined();
    expect(view.total).toBe(2);
  });

  it("источник упал — ответ прежний, без поля и без ошибки", async () => {
    const harness = await host(async () => { throw new Error("журнал недоступен"); });
    const view = (await harness.callRpc("getFlowProgress", { threadId: THREAD })) as Record<string, unknown>;
    expect(view.context).toBeUndefined();
    expect(view.total).toBe(2);
  });
});
