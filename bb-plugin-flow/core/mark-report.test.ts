// @vitest-environment node
import { describe, expect, it } from "vitest";

import { actionStage } from "../lib/stage-constants";
import type { FlowProgress, WorkStage } from "../shared/contract";
import { builtinAutomationStage, onRunStart, onStepDone, onStepFailed, stepsOf } from "./automation-run";
import { afterMark, markReply, startFact } from "./mark-report";
import { EMPTY_PROGRESS, onMark } from "./progress";
import { CODE_FLOW, stage } from "./stages-fixtures";

const T0 = "2026-09-26T10:00:00.000Z";
const T1 = "2026-09-26T10:01:00.000Z";

const publish: WorkStage = { ...builtinAutomationStage([]), id: "publish", name: "Publish", automation: { source: "flow", steps: ["git.create-pr"] } };
const land: WorkStage = { ...builtinAutomationStage(["publish"]), id: "land", name: "Land", automation: { source: "flow", steps: ["git.merge"] } };
const press: WorkStage = { ...actionStage([]), id: "press", name: "Press", automation: { source: "flow", steps: ["git.create-pr"] } };
const review = stage("review");
const testing = stage("testing");

const done = (progress: FlowProgress, id: string): FlowProgress => onMark(onMark(progress, id, "started", T0), id, "done", T1);
const started = (progress: FlowProgress, s: WorkStage): FlowProgress => onRunStart(progress, s.id, stepsOf(s), T0);
const failed = (progress: FlowProgress, s: WorkStage): FlowProgress => onStepFailed(started(progress, s), s.id, "no token", T1);

const automation = CODE_FLOW[11]!;

describe("что наступает за отмеченным этапом", () => {
  it("тред thr_897e6zxubm: за testing наступает автоматизация 12", () => {
    const progress = done(done(EMPTY_PROGRESS, "implement"), "testing");
    expect(afterMark(CODE_FLOW, progress, "testing")).toEqual({ kind: "due", stage: automation });
  });

  it("за этапом — этап агента, а за ним автоматизация: она ждёт этот этап", () => {
    expect(afterMark([review, testing, publish], done(EMPTY_PROGRESS, "review"), "review")).toEqual({ kind: "gate", stage: publish, gate: testing });
  });

  it("автоматизация за этапом уже прошла", () => {
    const ran = onStepDone(started(done(EMPTY_PROGRESS, "review"), publish), publish.id, T1);
    expect(afterMark([review, publish], ran, "review")).toEqual({ kind: "blocked", stage: publish, reason: { kind: "ran" } });
  });

  it("у самой автоматизации упал шаг", () => {
    const progress = done(failed(EMPTY_PROGRESS, publish), "review");
    expect(afterMark([review, publish], progress, "review")).toEqual({ kind: "blocked", stage: publish, reason: { kind: "failed", stage: publish, step: "git.create-pr", error: "no token" } });
  });

  it("раньше упала другая автоматизация — цепочка стоит", () => {
    const progress = done(failed(EMPTY_PROGRESS, publish), "review");
    expect(afterMark([publish, review, land], progress, "review")).toEqual({ kind: "blocked", stage: land, reason: { kind: "failed", stage: publish, step: "git.create-pr", error: "no token" } });
  });

  it("за этапом Action — он наступает по тому же правилу", () => {
    expect(afterMark([review, press], done(EMPTY_PROGRESS, "review"), "review")).toEqual({ kind: "due", stage: press });
  });

  it("вычеркнутый этап между отмеченным и автоматизацией пропускается", () => {
    const progress = { ...done(EMPTY_PROGRESS, "review"), stages: { ...done(EMPTY_PROGRESS, "review").stages, testing: { skipped: true } } };
    expect(afterMark([review, testing, publish], progress, "review")).toEqual({ kind: "due", stage: publish });
  });

  it("за этапом — этап агента без автоматизации следом: сказать нечего", () => {
    expect(afterMark([review, testing], done(EMPTY_PROGRESS, "review"), "review")).toEqual({ kind: "none" });
    expect(afterMark([review], done(EMPTY_PROGRESS, "review"), "review")).toEqual({ kind: "none" });
  });
});

describe("факт старта по записи прогресса", () => {
  it("прогон этапа записан — старт состоялся", () => {
    expect(startFact([review, publish], started(done(EMPTY_PROGRESS, "review"), publish), publish.id)).toEqual({ kind: "started" });
  });

  it("идёт другая автоматизация треда — тред занят ею", () => {
    const progress = started(done(EMPTY_PROGRESS, "review"), land);
    expect(startFact([land, review, publish], progress, publish.id)).toEqual({ kind: "busy", stage: land.id });
  });

  it("ни старта, ни занятости — факта пока нет", () => {
    expect(startFact([review, publish], done(EMPTY_PROGRESS, "review"), publish.id)).toBeNull();
  });
});

describe("ответ агенту", () => {
  const due = { kind: "due", stage: publish } as const;

  it("о старте говорит только по записанному старту", () => {
    expect(markReply("review", due, { kind: "started" })).toMatch(/Flow started the next stage publish/);
    expect(markReply("review", due, { kind: "started" })).toMatch(/end your turn/i);
    expect(markReply("review", due, { kind: "not-started" })).not.toMatch(/Flow started/);
  });

  it("не начатая автоматизация — прямо NOT started, почему и что сделать", () => {
    const reply = markReply("review", due, { kind: "not-started" });
    expect(reply).toMatch(/publish[^.]*was NOT started/);
    expect(reply).toMatch(/mark review started and done again/);
    expect(reply).toMatch(/do not tell the owner it runs/i);
  });

  it("занятый тред — не начата, стоит в очереди за идущим этапом", () => {
    const reply = markReply("review", due, { kind: "busy", stage: "land" });
    expect(reply).toMatch(/was NOT started yet/);
    expect(reply).toMatch(/land/);
    expect(reply).toMatch(/queued/);
  });

  it("причины блокировки называются с шагом и ошибкой", () => {
    const self = markReply("review", { kind: "blocked", stage: publish, reason: { kind: "failed", stage: publish, step: "git.create-pr", error: "no token" } }, null);
    expect(self).toMatch(/was NOT started/);
    expect(self).toMatch(/git\.create-pr[^.]*no token/);
    expect(self).toMatch(/Retry or Skip/);
    const other = markReply("review", { kind: "blocked", stage: land, reason: { kind: "failed", stage: publish, step: "git.create-pr", error: "no token" } }, null);
    expect(other).toMatch(/land[^.]*was NOT started/);
    expect(other).toMatch(/automation publish failed/);
    const ran = markReply("review", { kind: "blocked", stage: publish, reason: { kind: "ran" } }, null);
    expect(ran).toMatch(/already ran/);
    expect(ran).not.toMatch(/Flow started/);
  });

  it("этап агента перед автоматизацией — она не начата и стартует после него", () => {
    const reply = markReply("review", { kind: "gate", stage: publish, gate: testing }, null);
    expect(reply).toMatch(/publish[^.]*has NOT started/);
    expect(reply).toMatch(/once testing is marked done/);
  });

  it("этап Action — кнопки у владельца, агент заканчивает ход", () => {
    const reply = markReply("review", { kind: "due", stage: press }, { kind: "started" });
    expect(reply).toMatch(/press[^.]*is an action/);
    expect(reply).toMatch(/owner runs its steps with a button/);
    expect(reply).toMatch(/end your turn/i);
  });

  it("сказать нечего — пустая строка", () => {
    expect(markReply("review", { kind: "none" }, null)).toBe("");
  });
});
