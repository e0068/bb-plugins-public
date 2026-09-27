// @vitest-environment node
// Стык фичи с миром: настройки плагина и журнал треда — настоящие поверхности
// хоста, а не подставленные в registerProgress аргументы. Ровно одна строка
// сборки в server.ts, и другого способа доказать её нет.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { DEFAULT_STAGES } from "../core/flows";
import plugin from "../server";

const THREAD = "thr_wiring";

const usageEvent = (usedTokens: number, modelContextWindow: number) => ({
  type: "thread/contextWindowUsage/updated",
  data: { providerThreadId: "s1", contextWindowUsage: { usedTokens, modelContextWindow, estimated: true } },
});

const boot = async (events: unknown[], settings: Record<string, number> = {}) => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    settings,
    sdk: { threads: { events: { list: async () => events } } },
  });
  await plugin(bb);
  // Баннер отвечает только треду с записью прогресса: без брифа отвечать нечем.
  const stages = DEFAULT_STAGES.map((stage, index) => ({ id: stage.id, state: "todo", ...(index === 1 ? { recommended: true } : {}) }));
  await harness.callAgentTool("ask_decision", { title: "Бриф", setup: { stages } }, { threadId: THREAD });
  return harness;
};

describe("заполненность окна доезжает от журнала bb до ответа баннера", () => {
  it("событие журнала становится долей и порогами в токенах по умолчанию", async () => {
    const harness = await boot([usageEvent(250_000, 1_000_000)]);
    expect(await harness.callRpc("getFlowProgress", { threadId: THREAD })).toMatchObject({
      context: { share: 0.25, usedTokens: 250_000, windowTokens: 1_000_000, warnTokens: 250_000, alertTokens: 400_000 },
    });
  });

  it("события заполненности в журнале нет — поля нет, а прогресс на месте", async () => {
    const harness = await boot([{ type: "thread/identity", data: { providerThreadId: "s1" } }]);
    const view = (await harness.callRpc("getFlowProgress", { threadId: THREAD })) as { context?: unknown; stages: unknown[] };
    expect(view.context).toBeUndefined();
    expect(view.stages.length).toBeGreaterThan(0);
  });
});

describe("пара порогов в токенах сторожится на вводе: жёлтый строго меньше красного", () => {
  const thresholdsOf = async (harness: Awaited<ReturnType<typeof boot>>) =>
    ((await harness.callRpc("getFlowProgress", { threadId: THREAD })) as { context: { warnTokens: number; alertTokens: number } }).context;

  it("жёлтый не ниже красного — запись отклонена ошибкой с числом соседа, пара прежняя", async () => {
    const harness = await boot([usageEvent(1, 2)]);
    await expect(harness.setSettings({ contextWarnTokens: 400_000 })).rejects.toThrow(/lower than the red threshold \(400000 tokens\)/);
    expect(await thresholdsOf(harness)).toMatchObject({ warnTokens: 250_000, alertTokens: 400_000 });
  });

  it("красный не выше жёлтого — запись отклонена ошибкой с числом соседа", async () => {
    const harness = await boot([usageEvent(1, 2)]);
    await expect(harness.setSettings({ contextAlertTokens: 200_000 })).rejects.toThrow(/higher than the yellow threshold \(250000 tokens\)/);
  });

  it("сосед сверяется с последней записью: поднял красный — жёлтый может подняться за ним", async () => {
    const harness = await boot([usageEvent(1, 2)]);
    await harness.setSettings({ contextAlertTokens: 700_000 });
    await harness.setSettings({ contextWarnTokens: 600_000 });
    expect(await thresholdsOf(harness)).toMatchObject({ warnTokens: 600_000, alertTokens: 700_000 });
  });

  it("сосед берётся из хранилища с первой записи, а не из умолчаний", async () => {
    const harness = await boot([usageEvent(1, 2)], { contextWarnTokens: 300_000, contextAlertTokens: 600_000 });
    await harness.setSettings({ contextWarnTokens: 500_000 });
    expect(await thresholdsOf(harness)).toMatchObject({ warnTokens: 500_000, alertTokens: 600_000 });
  });

  it("отрицательное и дробное число токенов отклонено на обеих ручках", async () => {
    const harness = await boot([usageEvent(1, 2)]);
    await expect(harness.setSettings({ contextWarnTokens: -1 })).rejects.toThrow();
    await expect(harness.setSettings({ contextAlertTokens: 450_000.5 })).rejects.toThrow();
  });
});
