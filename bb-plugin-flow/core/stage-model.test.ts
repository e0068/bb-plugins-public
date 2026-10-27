// @vitest-environment node
// BBPL-968: модель этапа — от плана брифа через ответ владельца в след прогона и в прогноз.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { decisionBriefSchema, stageAnswerSchema, stageTrackSchema, type DecisionAnswer, type DecisionBrief, type Execution, type FlowProgress, type StageAnswer } from "../shared/contract";
import { forecast, stagePlans } from "./budget";
import { plannedModel, type CatalogModel } from "./context";
import { boundaryNote } from "./mark-report";
import { onAnswer, reopen } from "./progress";
import { SELF, answeredStageChoice, initialStageChoice, modelFactor, stageAdd, stageItems } from "./stages";
import { add, planner, report, stage, stagedBrief } from "./stages-fixtures";

const OPUS: Execution = { providerId: "claude-code", model: "claude-opus-4-1", reasoningLevel: "high" };
const SONNET: Execution = { providerId: "claude-code", model: "claude-sonnet-4-5", reasoningLevel: "high" };
const CATALOG: CatalogModel[] = [
  { model: "claude-opus-4-1", efforts: ["low", "medium", "high"] },
  { model: "claude-sonnet-4-5", efforts: ["low", "medium", "high"] },
  { model: "claude-sonnet-4-6", efforts: ["medium"] },
];

const spec = stage("spec", { skill: "spec", name: "Spec" });
const implement = stage("implement", { skill: "code-standards-fp", name: "Execution", executors: [planner] });
const land = stage("land", { skill: "", name: "Commit", automation: { source: "flow", steps: ["git.commit"] } });
const STAGES = [spec, implement, land];

const reports = [report("spec", { recommended: true, share: { percent: 20, risk: -1 } }), report("implement", { recommended: true, share: { percent: 100, risk: 2 } })];
const brief = (models: Record<string, Execution> | null = { spec: OPUS, implement: SONNET }): DecisionBrief =>
  stagedBrief(reports, {
    stages: { list: STAGES, minButtonWidth: 170, ...(models === null ? {} : { models, threadModel: OPUS }) },
    setup: { stages: reports, criteria: [{ text: "Тесты зелёные", add: add(10, 20, 2, 60) }] },
  });
const itemOf = (b: DecisionBrief, id: string) => stageItems(b).find((i) => i.stage.id === id)!;
const answer = (b: DecisionBrief, stages: StageAnswer[]): DecisionAnswer => ({ briefId: b.id, answers: [], stages });

describe("контракт: модель этапа в ответе, следе и брифе необязательна", () => {
  it("ответ на этап несёт модель и «model» среди тронутого", () => {
    const parsed = stageAnswerSchema.parse({ id: "implement", run: true, executor: SELF, model: SONNET, picked: ["model"] });
    expect(parsed).toMatchObject({ model: SONNET, picked: ["model"] });
  });

  it("след этапа и его следующий проход несут модель", () => {
    expect(stageTrackSchema.parse({ model: SONNET, nextPass: { skipped: false, model: OPUS } })).toMatchObject({ model: SONNET, nextPass: { model: OPUS } });
  });

  it("бриф несёт план моделей и модель треда", () => {
    const parsed = decisionBriefSchema.parse(brief());
    expect(parsed.stages).toMatchObject({ models: { spec: OPUS, implement: SONNET }, threadModel: OPUS });
  });

  it("старые записи без модели читаются", () => {
    expect(stageAnswerSchema.parse({ id: "spec", run: true, executor: SELF }).model).toBeUndefined();
    expect(stageTrackSchema.parse({ executor: SELF }).model).toBeUndefined();
    expect(decisionBriefSchema.parse(brief(null)).stages?.models).toBeUndefined();
  });
});

describe("предвыбор модели этапа", () => {
  it("реализация уходит на первую Sonnet каталога с effort треда", () => {
    expect(plannedModel(implement, OPUS, CATALOG)).toEqual(SONNET);
  });

  it("остальная работа агента остаётся на стоящей Opus", () => {
    expect(plannedModel(spec, OPUS, CATALOG)).toEqual(OPUS);
  });

  it("стоящая модель нужной роли не меняется на первую в каталоге", () => {
    const current: Execution = { providerId: "claude-code", model: "claude-sonnet-4-6", reasoningLevel: "medium" };
    expect(plannedModel(implement, current, CATALOG)).toEqual(current);
  });

  it("effort, которого модель не знает, — первый из её списка", () => {
    expect(plannedModel(implement, OPUS, [{ model: "claude-sonnet-4-6", efforts: ["medium", "low"] }])).toEqual({ providerId: "claude-code", model: "claude-sonnet-4-6", reasoningLevel: "medium" });
  });

  it("у модели без списка effort — effort треда", () => {
    expect(plannedModel(implement, OPUS, [{ model: "claude-sonnet-4-5", efforts: [] }])).toEqual(SONNET);
  });

  it("скорость треда в план не переносится", () => {
    expect(plannedModel(spec, { ...OPUS, serviceTier: "fast" }, CATALOG)).toEqual(OPUS);
  });

  it("Sonnet в каталоге нет или каталог пуст — плана нет", () => {
    expect(plannedModel(implement, OPUS, [{ model: "claude-opus-4-1", efforts: ["high"] }])).toBeNull();
    expect(plannedModel(implement, OPUS, [])).toBeNull();
  });

  it("автоматизацию ведёт Flow — модели у неё нет", () => {
    expect(plannedModel(land, OPUS, CATALOG)).toBeNull();
  });
});

describe("реплика границы называет смену модели", () => {
  it("план с моделью — агент слышит о смене модели этапа", () => {
    expect(boundaryNote({ compact: false, model: { model: "claude-sonnet-4-5", reasoningLevel: "high" } }, { via: "agent", stage: implement })).toContain("sets the model of stage");
  });

  it("план без модели — о модели ни слова", () => {
    expect(boundaryNote({ compact: true, model: null }, { via: "agent", stage: implement })).not.toContain("model");
  });
});

describe("выбор этапа несёт модель плана", () => {
  it("без ответа — модель из плана брифа", () => {
    expect(initialStageChoice(brief(), itemOf(brief(), "implement")).model).toEqual(SONNET);
    expect(initialStageChoice(brief(), itemOf(brief(), "spec")).model).toEqual(OPUS);
  });

  it("бриф без плана — выбор без модели", () => {
    expect(initialStageChoice(brief(null), itemOf(brief(null), "implement")).model).toBeUndefined();
  });

  it("в ответе — модель ответа; ответ без модели модели не даёт", () => {
    const b = brief();
    expect(answeredStageChoice(b, answer(b, [{ id: "implement", run: true, executor: SELF, model: OPUS }]), itemOf(b, "implement")).model).toEqual(OPUS);
    expect(answeredStageChoice(b, answer(b, [{ id: "implement", run: true, executor: SELF }]), itemOf(b, "implement")).model).toBeUndefined();
  });
});

describe("цена этапа на Sonnet ниже, чем на Opus", () => {
  const scope = add(10, 20, 2, 60);
  const item = () => itemOf(brief(), "spec");

  it("множитель модели: Opus 1, Sonnet 0,6, Haiku 0,2, прочие и неизвестная — 1", () => {
    expect([modelFactor("claude-opus-4-1"), modelFactor("claude-sonnet-4-5"), modelFactor("Claude-Haiku-4-5"), modelFactor("gpt-5"), modelFactor(undefined)]).toEqual([1, 0.6, 0.2, 1, 1]);
  });

  it("этап Main Agent на Sonnet в треде на Opus стоит 0,6 от прежнего", () => {
    expect(stageAdd(item(), SELF, scope, { stage: SONNET.model, thread: OPUS.model })).toMatchObject({ target: 1.2, max: 2.4, minutes: 7 });
  });

  it("без модели и на модели треда цена прежняя", () => {
    const plain = stageAdd(item(), SELF, scope);
    expect(plain).toMatchObject({ target: 2, max: 4, minutes: 12 });
    expect(stageAdd(item(), SELF, scope, { stage: OPUS.model, thread: OPUS.model })).toEqual(plain);
  });

  it("у агента-исполнителя модель этапа цену не меняет", () => {
    const b = brief();
    const agentItem = itemOf(b, "implement");
    expect(stageAdd(agentItem, planner.id, scope, { stage: SONNET.model, thread: OPUS.model })).toEqual(stageAdd(agentItem, planner.id, scope));
  });

  it("тот же этап на Sonnet никогда не дороже, чем на Opus", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100 }), fc.integer({ min: 0, max: 1000 }), (percent, target) => {
        const b = stagedBrief([report("spec", { share: { percent, risk: 0 } })], { stages: { list: STAGES, minButtonWidth: 170 } });
        const s = itemOf(b, "spec");
        const cost = add(target, target * 2, 0, target);
        const onSonnet = stageAdd(s, SELF, cost, { stage: SONNET.model, thread: OPUS.model })!;
        const onOpus = stageAdd(s, SELF, cost, { stage: OPUS.model, thread: OPUS.model })!;
        return onSonnet.target <= onOpus.target && onSonnet.max <= onOpus.max;
      }),
    );
  });
});

describe("прогноз дешевеет, когда этап на Sonnet", () => {
  const b = brief();
  const choose = (model: Execution): DecisionAnswer =>
    answer(b, [
      { id: "spec", run: true, executor: SELF, model: OPUS },
      { id: "implement", run: true, executor: SELF, model },
    ]);

  it("итог брифа с реализацией на Sonnet ниже, чем на Opus", () => {
    expect(forecast(b, choose(SONNET)).target).toBeLessThan(forecast(b, choose(OPUS)).target);
  });

  it("план этапа в прогоне — с множителем его модели", () => {
    expect(stagePlans(b, choose(SONNET)).implement).toEqual({ minutes: 36, target: 6 });
    expect(stagePlans(b, choose(OPUS)).implement).toEqual({ minutes: 60, target: 10 });
  });
});

describe("ответ пишет модель этапа в след", () => {
  const AT = "2026-10-27T10:00:00.000Z";
  const b = brief();

  it("модель ответа ложится в след этапа, ответ без модели её снимает", () => {
    const start: FlowProgress = { stages: { implement: { executor: SELF, model: OPUS } }, waiting: [] };
    const after = onAnswer(start, b, answer(b, [{ id: "spec", run: true, executor: SELF }, { id: "implement", run: true, executor: SELF, model: SONNET }]), AT);
    expect(after.stages.implement?.model).toEqual(SONNET);
    expect(after.stages.spec?.model).toBeUndefined();
    const dropped = onAnswer(after, b, answer(b, [{ id: "implement", run: true, executor: SELF }]), AT);
    expect(dropped.stages.implement?.model).toBeUndefined();
  });

  it("у пройденного этапа модель ждёт нового прохода и ложится в след, когда доработка его откроет", () => {
    const done: FlowProgress = { stages: { spec: { startedAt: AT, finishedAt: AT }, implement: { startedAt: AT, finishedAt: AT, executor: SELF, model: OPUS } }, waiting: [] };
    const after = onAnswer(done, b, answer(b, [{ id: "implement", run: true, executor: SELF, model: SONNET }]), AT);
    expect(after.stages.implement).toMatchObject({ model: OPUS, nextPass: { skipped: false, executor: SELF, model: SONNET } });
    expect(reopen(after, STAGES, "spec", AT).stages.implement?.model).toEqual(SONNET);
  });
});
