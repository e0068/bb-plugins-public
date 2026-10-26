// @vitest-environment node
import { describe, expect, it } from "vitest";

import { stage } from "../core/stages-fixtures";
import type { ContextFillView } from "../shared/contract";
import { createStageModels, type ThreadModels } from "./stage-models";

const CATALOG = [{ model: "claude-opus-4-1" }, { model: "claude-opus-4-5" }, { model: "claude-sonnet-4-5" }];
const implement = stage("implement", { skill: "code-standards-fp" });
const review = stage("review");
const fill = (usedTokens: number): ContextFillView => ({ share: 0.1, usedTokens, windowTokens: 1_000_000, warnTokens: 150_000, alertTokens: 300_000 });

const planner = (state: { current: string | null; used?: number; models?: ThreadModels | null }) =>
  createStageModels({
    context: async () => fill(state.used ?? 10_000),
    models: async () => (state.models === undefined ? { current: state.current, models: CATALOG } : state.models),
  });

describe("план обслуживания перед этапом", () => {
  it("модель этапа и сжатие по контексту — одним планом", async () => {
    expect(await planner({ current: "claude-opus-4-1", used: 200_000 }).plan("t", implement, true)).toEqual({ compact: true, model: "claude-sonnet-4-5" });
  });

  it("без замера контекста (ответ на бриф) тон обычный: только модель", async () => {
    expect(await planner({ current: "claude-opus-4-1", used: 400_000 }).plan("t", implement, false)).toEqual({ compact: false, model: "claude-sonnet-4-5" });
  });

  it("та же модель и обычный контекст — плана нет", async () => {
    expect(await planner({ current: "claude-sonnet-4-5" }).plan("t", implement, true)).toBeNull();
  });

  it("тред не Claude Code — модели нет, остаётся сжатие", async () => {
    expect(await planner({ current: null, used: 200_000, models: null }).plan("t", implement, true)).toEqual({ compact: true, model: null });
  });

  it("сбой чтения модели или контекста плана не ломает", async () => {
    const broken = createStageModels({
      context: async () => {
        throw new Error("нет журнала");
      },
      models: async () => {
        throw new Error("нет каталога");
      },
    });
    expect(await broken.plan("t", implement, true)).toBeNull();
  });

  it("с Opus на Sonnet и обратно: возвращается та Opus, что стояла до реализации", async () => {
    const state = { current: "claude-opus-4-5" as string | null };
    const models = createStageModels({ models: async () => ({ current: state.current, models: CATALOG }) });
    expect(await models.plan("t", implement, false)).toEqual({ compact: false, model: "claude-sonnet-4-5" });
    state.current = "claude-sonnet-4-5";
    expect(await models.plan("t", review, false)).toEqual({ compact: false, model: "claude-opus-4-5" });
  });

  it("запомненная модель чужого треда не подставляется", async () => {
    const models = createStageModels({ models: async (threadId) => ({ current: threadId === "a" ? "claude-opus-4-5" : "claude-sonnet-4-5", models: CATALOG }) });
    await models.plan("a", implement, false);
    expect(await models.plan("b", review, false)).toEqual({ compact: false, model: "claude-opus-4-1" });
  });
});

describe("модель, выбранная владельцем, главнее модели этапа", () => {
  const switching = (state: { current: string }) => createStageModels({ models: async () => ({ current: state.current, models: CATALOG }) });

  it("выбор владельца в брифе: модель не меняется, сжатие по контексту остаётся", async () => {
    const models = createStageModels({ context: async () => fill(200_000), models: async () => ({ current: "claude-opus-4-1", models: CATALOG }) });
    models.owner("t", true);
    expect(await models.plan("t", implement, true)).toEqual({ compact: true, model: null });
    expect(await models.plan("t", implement, false)).toBeNull();
  });

  it("выбор владельца в одном треде другого не касается", async () => {
    const models = planner({ current: "claude-opus-4-1" });
    models.owner("a", true);
    expect(await models.plan("b", implement, false)).toEqual({ compact: false, model: "claude-sonnet-4-5" });
  });

  it("ответ без выбора возвращает управление Flow: текущая модель становится исходной", async () => {
    const state = { current: "claude-opus-4-1" };
    const models = switching(state);
    await models.plan("t", review, false);
    models.owner("t", true);
    state.current = "claude-opus-4-5";
    expect(await models.plan("t", implement, false)).toBeNull();
    models.owner("t", false);
    expect(await models.plan("t", implement, false)).toEqual({ compact: false, model: "claude-sonnet-4-5" });
    state.current = "claude-sonnet-4-5";
    expect(await models.plan("t", review, false)).toEqual({ compact: false, model: "claude-opus-4-5" });
  });

  it("ответ без выбора, когда выбора не было, исходную модель не стирает", async () => {
    const state = { current: "claude-opus-4-1" };
    const models = switching(state);
    await models.plan("t", implement, false);
    state.current = "claude-sonnet-4-5";
    models.owner("t", false);
    expect(await models.plan("t", review, false)).toEqual({ compact: false, model: "claude-opus-4-1" });
  });

  it("владелец сменил модель руками: ни Sonnet на реализации, ни возврат на Opus; сжатие остаётся", async () => {
    const state = { current: "claude-opus-4-1" };
    const models = createStageModels({ context: async () => fill(200_000), models: async () => ({ current: state.current, models: CATALOG }) });
    expect(await models.plan("t", implement, true)).toEqual({ compact: true, model: "claude-sonnet-4-5" });
    state.current = "claude-opus-4-5";
    expect(await models.plan("t", implement, true)).toEqual({ compact: true, model: null });
    expect(await models.plan("t", review, true)).toEqual({ compact: true, model: null });
  });

  it("модель, которую Flow сам поставил, и исходная ручной сменой не считаются", async () => {
    const state = { current: "claude-opus-4-1" };
    const models = switching(state);
    await models.plan("t", implement, false);
    state.current = "claude-sonnet-4-5";
    expect(await models.plan("t", review, false)).toEqual({ compact: false, model: "claude-opus-4-1" });
    state.current = "claude-opus-4-1";
    expect(await models.plan("t", implement, false)).toEqual({ compact: false, model: "claude-sonnet-4-5" });
  });
});
