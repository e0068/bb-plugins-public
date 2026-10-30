// @vitest-environment node
import { describe, expect, it } from "vitest";

import { actionStage } from "../lib/stage-constants";
import type { FlowProgress, WorkStage } from "../shared/contract";
import { builtinAutomationStage } from "./automation-run";
import { boundaryNote, nextWork, stageRef, upcomingAfter } from "./mark-report";
import { EMPTY_PROGRESS, onMark } from "./progress";
import { stage } from "./stages-fixtures";

const T0 = "2026-10-26T10:00:00.000Z";
const T1 = "2026-10-26T10:01:00.000Z";

const publish: WorkStage = { ...builtinAutomationStage([]), id: "publish", name: "Publish", automation: { source: "flow", steps: ["git.create-pr"] } };
const land: WorkStage = { ...builtinAutomationStage(["land"]), id: "land", name: "Land", automation: { source: "flow", steps: ["git.merge"] } };
const press: WorkStage = { ...actionStage([]), id: "press", name: "Press", automation: { source: "flow", steps: ["git.create-pr"] } };
const review = stage("review", { name: "Review" });
const implement = stage("implement", { skill: "code-standards-fp", name: "Implementation" });
const testing = stage("testing", { skill: "testing-tdd", name: "Testing" });

const done = (progress: FlowProgress, id: string): FlowProgress => onMark(onMark(progress, id, "started", T0), id, "done", T1);

describe("следующая работа агента за отмеченным этапом", () => {
  it("за этапом сразу этап агента — он и есть следующий", () => {
    expect(upcomingAfter([review, implement], done(EMPTY_PROGRESS, "review"), "review")).toEqual({ via: "agent", stage: implement });
  });

  it("за этапом автоматизация, а за ней этап агента — следующий агент за автоматизацией", () => {
    expect(upcomingAfter([review, publish, testing], done(EMPTY_PROGRESS, "review"), "review")).toEqual({ via: "automation", stage: testing });
  });

  it("цепочка автоматизаций подряд проходится до этапа агента", () => {
    expect(upcomingAfter([review, publish, land, testing], done(EMPTY_PROGRESS, "review"), "review")).toEqual({ via: "automation", stage: testing });
  });

  it("за автоматизацией работы агента нет — границы нет", () => {
    expect(upcomingAfter([review, publish], done(EMPTY_PROGRESS, "review"), "review")).toBeNull();
  });

  it("за этапом Action ждёт владелец, а не агент — границы нет", () => {
    expect(upcomingAfter([review, press, testing], done(EMPTY_PROGRESS, "review"), "review")).toBeNull();
    expect(upcomingAfter([review, publish, press, testing], done(EMPTY_PROGRESS, "review"), "review")).toBeNull();
  });

  it("отмеченный этап последний — границы нет", () => {
    expect(upcomingAfter([review], done(EMPTY_PROGRESS, "review"), "review")).toBeNull();
  });

  it("вычеркнутый этап пропускается", () => {
    const progress = { ...done(EMPTY_PROGRESS, "review"), stages: { ...done(EMPTY_PROGRESS, "review").stages, implement: { skipped: true } } };
    expect(upcomingAfter([review, implement, testing], progress, "review")).toEqual({ via: "agent", stage: testing });
  });
});

describe("отметка задним числом: следующий этап — не уже закрытый", () => {
  const questions = stage("questions", { name: "Questions" });
  const practice = stage("practice", { skill: "code-standards-fp", name: "Execution" });
  const codeReview = stage("code-review", { skill: "code-review", name: "code-review" });

  // Тред 29.10: «practice — done», затем «questions — done» — questions стоит в прогоне раньше уже закрытого practice.
  const journal = done(done(EMPTY_PROGRESS, "practice"), "questions");

  it("закрытый этап агента пропускается: за questions ждёт code-review, а не закрытый practice", () => {
    expect(upcomingAfter([questions, practice, codeReview], journal, "questions")).toEqual({ via: "agent", stage: codeReview });
  });

  it("закрытая автоматизация в цепочке пропускается тоже", () => {
    expect(upcomingAfter([review, publish, testing], done(done(EMPTY_PROGRESS, "publish"), "review"), "review")).toEqual({ via: "agent", stage: testing });
  });

  it("всё за отмеченным этапом закрыто — работы нет", () => {
    expect(upcomingAfter([questions, practice], journal, "questions")).toBeNull();
  });
});

describe("что ответ flow_stage говорит о границе", () => {
  const next = { via: "agent", stage: implement } as const;

  it("называет этап подписью с id и названием", () => {
    expect(stageRef(implement)).toBe('implement "Implementation"');
  });

  it("агенту: закончить ход, сжатие, модель и «продолжай»", () => {
    expect(boundaryNote({ compact: true, model: { model: "claude-sonnet-4-5", reasoningLevel: "high" } }, next)).toBe(
      ' End your turn now: Flow compacts the thread, sets the model of stage implement "Implementation" and sends you "carry on".',
    );
  });

  it("без сжатия — только модель", () => {
    expect(boundaryNote({ compact: false, model: { model: "claude-sonnet-4-5", reasoningLevel: "high" } }, next)).toBe(' End your turn now: Flow sets the model of stage implement "Implementation" and sends you "carry on".');
  });

  it("без модели — только сжатие", () => {
    expect(boundaryNote({ compact: true, model: null }, next)).toBe(' End your turn now: Flow compacts the thread and sends you "carry on".');
  });

  it("перед автоматизацией ход кончается и так: ответ говорит, что Flow сделает до будящей реплики", () => {
    expect(boundaryNote({ compact: true, model: { model: "claude-sonnet-4-5", reasoningLevel: "high" } }, { via: "automation", stage: testing })).toBe(
      ' Before the message that wakes you, Flow compacts the thread and sets the model of stage testing "Testing".',
    );
  });
});

describe("следующая работа агента по записи прогресса", () => {
  it("первый незакрытый этап прогона — этап агента", () => {
    expect(nextWork([review, implement], done(EMPTY_PROGRESS, "review"))).toEqual({ via: "agent", stage: implement });
    expect(nextWork([review, implement], EMPTY_PROGRESS)).toEqual({ via: "agent", stage: review });
  });

  it("первый незакрытый — автоматизация: следующий агент за ней, через автоматизацию", () => {
    expect(nextWork([review, publish, testing], done(EMPTY_PROGRESS, "review"))).toEqual({ via: "automation", stage: testing });
  });

  it("вычеркнутый этап пропускается; Action обрывает цепочку; всё закрыто — работы нет", () => {
    const skipped = { ...EMPTY_PROGRESS, stages: { review: { skipped: true } } };
    expect(nextWork([review, implement], skipped)).toEqual({ via: "agent", stage: implement });
    expect(nextWork([review, press, testing], done(EMPTY_PROGRESS, "review"))).toBeNull();
    expect(nextWork([review], done(EMPTY_PROGRESS, "review"))).toBeNull();
  });
});
