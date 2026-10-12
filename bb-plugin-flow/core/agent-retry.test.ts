// @vitest-environment node
// Агент зовёт «повторить» на упавшем шаге автоматизации: что допускается и что агент читает в ответе.
import { describe, expect, it } from "vitest";

import { actionStage } from "../lib/stage-constants";
import type { FlowProgress, WorkStage } from "../shared/contract";
import { builtinAutomationStage, onRunStart, onStepDone, onStepFailed, stepsOf } from "./automation-run";
import { notStartedReply, retriedReply, retryVerdict } from "./agent-retry";
import { stopFailure } from "./mark-report";
import { EMPTY_PROGRESS } from "./progress";
import { stage } from "./stages-fixtures";

const T0 = "2026-10-13T10:00:00.000Z";
const T1 = "2026-10-13T10:01:00.000Z";

const land: WorkStage = { ...builtinAutomationStage([]), id: "land", name: "Commit, PR", automation: { source: "flow", steps: ["git.create-pr"] } };
const press: WorkStage = { ...actionStage([]), id: "press", name: "Press", automation: { source: "flow", steps: ["git.create-pr"] } };
const review = stage("review");
const STAGES = [review, land, press];

const started = (progress: FlowProgress, s: WorkStage): FlowProgress => onRunStart(progress, s.id, stepsOf(s), T0);
const failed = (s: WorkStage): FlowProgress => onStepFailed(started(EMPTY_PROGRESS, s), s.id, "gh: rate limited", T1);

describe("когда агенту можно повторить шаг", () => {
  it("упавший шаг автоматизации — повтор допускается", () => {
    expect(retryVerdict(STAGES, failed(land), "land")).toEqual({ kind: "retry", stage: land });
  });

  it("этапа с таким id во flow нет — отказ называет id этапов flow", () => {
    expect(retryVerdict(STAGES, failed(land), "nope")).toEqual({ kind: "refused", reason: "Stage nope is not a stage of the thread's flow: review, land, press." });
  });

  it("этап агента — отказ: повторять нечего", () => {
    const verdict = retryVerdict(STAGES, EMPTY_PROGRESS, "review");
    expect(verdict.kind).toBe("refused");
    expect(verdict).toMatchObject({ reason: expect.stringContaining("is not an automation") });
  });

  it("этап Action — отказ: его шаги нажимает владелец", () => {
    expect(retryVerdict(STAGES, failed(press), "press")).toMatchObject({ kind: "refused", reason: expect.stringContaining("is an action") });
  });

  it("шаг ещё не начат — отказ: упавшего шага нет", () => {
    expect(retryVerdict(STAGES, EMPTY_PROGRESS, "land")).toMatchObject({ kind: "refused", reason: expect.stringContaining("has no failed step") });
  });

  it("шаг идёт без ошибки — отказ: упавшего шага нет", () => {
    expect(retryVerdict(STAGES, started(EMPTY_PROGRESS, land), "land")).toMatchObject({ kind: "refused", reason: expect.stringContaining("has no failed step") });
  });

  it("этап уже закрыт — отказ: упавшего шага нет", () => {
    const closed = onStepDone(started(EMPTY_PROGRESS, land), land.id, T1);
    expect(retryVerdict(STAGES, closed, "land")).toMatchObject({ kind: "refused", reason: expect.stringContaining("has no failed step") });
  });
});

describe("ответ на повтор, который Flow не начал", () => {
  it("тред занят другой работой Flow — повторить позже", () => {
    expect(notStartedReply({ started: false, busy: true })).toContain("busy");
  });

  it("шаг уже не ждёт — повторять нечего", () => {
    expect(notStartedReply({ started: false })).toContain("no longer waiting");
  });
});

describe("ответ на повтор, который Flow начал и доиграл", () => {
  const failure = stopFailure(STAGES, failed(land));

  it("реплика Flow — агенту в этот же ход", () => {
    const text = retriedReply(land, { kind: "reply", text: "Flow: the automation stage is done." }, null);
    expect(text).toContain('Flow retried stage land "Commit, PR"');
    expect(text).toContain("Flow: the automation stage is done.");
  });

  it("повтор упал снова — ответ называет шаг и ошибку и разрешает чинить и повторять дальше", () => {
    const text = retriedReply(land, { kind: "quiet" }, failure);
    expect(text).toContain("failed again at step git.create-pr (gh: rate limited)");
    expect(text).toContain("retry_automation");
  });

  it("за упавшим шагом назначен автоповтор — ответ называет срок и не просит повторять агента", () => {
    const text = retriedReply(land, { kind: "quiet" }, { kind: "failed", stage: land, step: "git.create-pr", error: "gh: rate limited", retryAt: "2026-10-13T10:00:30.000Z" });
    expect(text).toContain("failed again at step git.create-pr (gh: rate limited)");
    expect(text).toContain("Flow retries the step by itself at 2026-10-13T10:00:30.000Z");
    expect(text).not.toContain("retry_automation");
  });

  it("цепочку после повтора остановил шаг другой автоматизации — ответ называет её, а не этап повтора", () => {
    const other: WorkStage = { ...builtinAutomationStage([]), id: "publish", name: "Publish", automation: { source: "flow", steps: ["git.merge"] } };
    const stopped = stopFailure([land, other], onStepFailed(started(EMPTY_PROGRESS, other), other.id, "conflict", T1));
    const text = retriedReply(land, { kind: "quiet" }, stopped);
    expect(text).toContain("then the chain stopped at automation publish: step git.merge failed (conflict)");
    expect(text).toContain('retry_automation { "stage": "publish" }');
    expect(text).not.toContain("failed again");
  });

  it("повтор прошёл, будить некого — ход кончается молча", () => {
    expect(retriedReply(land, { kind: "quiet" }, null)).toContain("went through");
  });

  it("шаг ещё идёт, а вызов не дождался — ход кончается, Flow напишет сам", () => {
    for (const kind of ["timeout", "aborted"] as const) expect(retriedReply(land, { kind }, null)).toContain("still runs");
  });
});
