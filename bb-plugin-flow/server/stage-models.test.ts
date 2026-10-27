// @vitest-environment node
// BBPL-968: граница ставит утверждённую модель этапа из следа прогона — без своей логики ролей и без памяти о владельце.
import { describe, expect, it } from "vitest";

import type { StageModel } from "../core/context";
import { stage } from "../core/stages-fixtures";
import type { ContextFillView, Execution, FlowProgress } from "../shared/contract";
import { createStageModels } from "./stage-models";

const implement = stage("implement", { skill: "code-standards-fp" });
const review = stage("review");
const fill = (usedTokens: number): ContextFillView => ({ share: 0.1, usedTokens, windowTokens: 1_000_000, warnTokens: 150_000, alertTokens: 300_000 });

const OPUS: StageModel = { model: "claude-opus-4-1", reasoningLevel: "high" };
const SONNET: Execution = { providerId: "claude-code", model: "claude-sonnet-4-5", reasoningLevel: "medium", serviceTier: "fast" };
const record = (models: Record<string, Execution>): FlowProgress => ({ stages: Object.fromEntries(Object.entries(models).map(([id, model]) => [id, { model }])), waiting: [] });

const planner = (state: { current: StageModel | null; used?: number }) =>
  createStageModels({
    context: async () => fill(state.used ?? 10_000),
    current: async () => state.current,
  });

describe("граница ставит утверждённую модель этапа", () => {
  it("утверждённая модель и effort этапа из следа — в план, без провайдера и скорости", async () => {
    expect(await planner({ current: OPUS }).plan("t", implement, false, record({ implement: SONNET }))).toEqual({ compact: false, model: { model: "claude-sonnet-4-5", reasoningLevel: "medium" } });
  });

  it("сжатие по контексту и модель — одним планом", async () => {
    expect(await planner({ current: OPUS, used: 200_000 }).plan("t", implement, true, record({ implement: SONNET }))).toEqual({ compact: true, model: { model: "claude-sonnet-4-5", reasoningLevel: "medium" } });
  });

  it("этап без утверждённой модели модель треда не трогает — даже реализация", async () => {
    expect(await planner({ current: OPUS }).plan("t", implement, false, record({}))).toBeNull();
    expect(await planner({ current: OPUS, used: 200_000 }).plan("t", implement, true, record({ review: SONNET }))).toEqual({ compact: true, model: null });
  });

  it("утверждённое уже стоит — плана нет", async () => {
    expect(await planner({ current: { model: "claude-sonnet-4-5", reasoningLevel: "medium" } }).plan("t", implement, false, record({ implement: SONNET }))).toBeNull();
  });

  it("владелец сменил модель руками — следующая граница всё равно ставит утверждённую", async () => {
    const state = { current: OPUS as StageModel | null };
    const models = planner(state);
    state.current = { model: "claude-haiku-4-5", reasoningLevel: "low" };
    expect(await models.plan("t", review, false, record({ review: { providerId: "claude-code", ...OPUS } }))).toEqual({ compact: false, model: OPUS });
  });

  it("модель треда не прочлась или тред не Claude Code — модель не трогается, сжатие остаётся", async () => {
    expect(await planner({ current: null, used: 200_000 }).plan("t", implement, true, record({ implement: SONNET }))).toEqual({ compact: true, model: null });
    expect(await planner({ current: null }).plan("t", implement, false, record({ implement: SONNET }))).toBeNull();
  });

  it("сбой чтения модели или контекста плана не ломает", async () => {
    const broken = createStageModels({
      context: async () => {
        throw new Error("нет журнала");
      },
      current: async () => {
        throw new Error("нет каталога");
      },
    });
    expect(await broken.plan("t", implement, true, record({ implement: SONNET }))).toBeNull();
  });
});
