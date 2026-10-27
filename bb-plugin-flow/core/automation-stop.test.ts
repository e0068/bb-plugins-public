// @vitest-environment node
// BBPL-969: остановка автоматизации владельцем — в следе этапа, в его виде и в реплике агенту.
import { describe, expect, it } from "vitest";

import { automationRpcContract, flowProgressSchema, progressStageSchema, stageTrackSchema, type FlowProgress, type WorkStage } from "../shared/contract";
import { STOPPED_ERROR, automationView, isFailed, onRunRetry, onRunStopped, onRunStopping, stoppedWakeText } from "./automation-run";

const ship: WorkStage = { id: "ship", kind: "skill", skill: "", name: "Commit, PR", executors: [], automation: { source: "flow", steps: ["git.commit", "git.create-pr"] } };
const steps = [
  { id: "git.commit", label: "Commit" },
  { id: "git.create-pr", label: "Open a PR" },
];
const running = (at: number): FlowProgress => ({ stages: { ship: { startedAt: "2026-10-27T10:00:00.000Z", run: { steps, at, error: null } } }, waiting: [] });

describe("контракт: остановка в следе, виде и RPC", () => {
  it("след прогона несёт «останавливается» и «остановлен»", () => {
    expect(stageTrackSchema.parse({ run: { steps, at: 0, error: null, stopping: true } }).run?.stopping).toBe(true);
    expect(stageTrackSchema.parse({ run: { steps, at: 0, error: STOPPED_ERROR, stopped: true } }).run?.stopped).toBe(true);
  });

  it("вид этапа несёт остановку и состояние шага «остановлен»; старый вид читается без них", () => {
    const base = { id: "ship", kind: "skill", name: "Ship", executor: "self", state: "fail", results: [], minutes: null, cost: null };
    const stopped = progressStageSchema.parse({ ...base, automation: { steps: [{ id: "git.commit", label: "Commit", state: "stop", error: STOPPED_ERROR }], stopped: true } });
    expect(stopped.automation).toMatchObject({ stopped: true, stopping: false, steps: [{ state: "stop" }] });
    expect(progressStageSchema.parse({ ...base, automation: { steps: [] } }).automation).toMatchObject({ stopping: false, stopped: false });
  });

  it("RPC остановки объявлен рядом с повтором", () => {
    expect(Object.keys(automationRpcContract)).toContain("stopAutomation");
  });

  it("старая запись прогона читается без полей остановки", () => {
    expect(flowProgressSchema.parse(running(1)).stages.ship?.run).toEqual({ steps, at: 1, error: null });
  });
});

describe("остановка в следе этапа", () => {
  it("запрос остановки помечает идущий прогон и больше ничего не меняет", () => {
    const after = onRunStopping(running(0), "ship");
    expect(after.stages.ship?.run).toEqual({ steps, at: 0, error: null, stopping: true });
    expect(isFailed(after.stages.ship!)).toBe(false);
  });

  it("остановленный этап ждёт владельца, как упавший, но без срока автоповтора", () => {
    const after = onRunStopped(onRunStopping(running(1), "ship"), "ship", STOPPED_ERROR);
    const run = after.stages.ship?.run;
    expect(run).toMatchObject({ at: 1, error: STOPPED_ERROR, stopped: true });
    expect(run?.stopping).toBeUndefined();
    expect(run?.retryAt).toBeUndefined();
    expect(isFailed(after.stages.ship!)).toBe(true);
  });

  it("ошибка шага, на котором остановили, сохраняется", () => {
    expect(onRunStopped(running(0), "ship", "The script a.sh exited with code 1:").stages.ship?.run?.error).toBe("The script a.sh exited with code 1:");
  });

  it("повтор снимает остановку: шаг снова идёт", () => {
    const after = onRunRetry(onRunStopped(running(1), "ship", STOPPED_ERROR), "ship");
    expect(after.stages.ship?.run).toEqual({ steps, at: 1, error: null });
  });

  it("этап без прогона не меняется", () => {
    const idle: FlowProgress = { stages: { ship: {} }, waiting: [] };
    expect(onRunStopping(idle, "ship")).toEqual(idle);
    expect(onRunStopped(idle, "ship", STOPPED_ERROR)).toEqual(idle);
  });
});

describe("вид остановленного этапа", () => {
  it("остановленный шаг — состояние stop с ошибкой, сделанные — done, впереди — todo", () => {
    const view = automationView(ship, onRunStopped(running(1), "ship", STOPPED_ERROR).stages.ship!);
    expect(view.steps.map((s) => s.state)).toEqual(["done", "stop"]);
    expect(view.steps[1]?.error).toBe(STOPPED_ERROR);
    expect(view).toMatchObject({ stopped: true, stopping: false });
  });

  it("запрос остановки виден у идущего этапа", () => {
    const view = automationView(ship, onRunStopping(running(0), "ship").stages.ship!);
    expect(view.steps.map((s) => s.state)).toEqual(["now", "todo"]);
    expect(view).toMatchObject({ stopping: true, stopped: false });
  });

  it("упавший шаг остаётся упавшим", () => {
    const failed = { ...running(0).stages.ship!, run: { steps, at: 0, error: "boom" } };
    expect(automationView(ship, failed)).toMatchObject({ stopped: false, stopping: false, steps: [{ state: "fail" }, { state: "todo" }] });
  });
});

describe("реплика агенту об остановке", () => {
  it("говорит, что остановил владелец, где, что сделанное не откатано и что продолжает владелец", () => {
    expect(stoppedWakeText(ship, "git.create-pr")).toBe(
      'Flow: automation ship "Commit, PR" was stopped by the owner at step git.create-pr. Steps already done are not undone. Do not retry or work around it yourself — the owner presses Continue in the banner header.',
    );
  });
});
