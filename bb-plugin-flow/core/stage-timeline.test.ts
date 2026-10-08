// @vitest-environment node
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import { AUTOMATION_ICON, EXECUTOR_ICONS, KIND_ICONS } from "../lib/stage-icon-names";
import type { FlowProgress, WorkStage } from "../shared/contract";
import { EMPTY_PROGRESS, onMark, reopen } from "./progress";
import { stageTimeline } from "./stage-timeline";
import { stage } from "./stages-fixtures";

const at = (minute: number) => `2026-10-08T10:${String(minute).padStart(2, "0")}:00.000Z`;

const commit: WorkStage = { ...stage("commit"), automation: { source: "flow", steps: ["git.commit"] } };
const STAGES: WorkStage[] = [builtinStage("questions", []), stage("prototype", { icon: "Album01" }), builtinStage("demo", []), stage("spec"), commit];

/** Отметки так, как их пишет flow_stage: «started» сперва сбрасывает этапы за доработкой. */
const start = (progress: FlowProgress, id: string, minute: number) => onMark(reopen(progress, STAGES, id, at(minute)), id, "started", at(minute));
const done = (progress: FlowProgress, id: string, minute: number) => onMark(progress, id, "done", at(minute));

/** Прототип, демонстрация с комментарием, доработка прототипа и вторая демонстрация, которая ещё ждёт владельца. */
const reworked = (): FlowProgress => {
  const first = done(start(done(start(EMPTY_PROGRESS, "prototype", 0), "prototype", 10), "demo", 10), "demo", 20);
  return start(done(start(first, "prototype", 20), "prototype", 30), "demo", 30);
};

describe("этапы треда на шкале времени", () => {
  it("доработка сохраняет начало и конец каждого прошлого прохода", () => {
    const twice = start(done(start(reworked(), "prototype", 40), "prototype", 45), "demo", 45);
    expect(twice.stages.prototype?.passes).toEqual([
      { from: at(0), to: at(10) },
      { from: at(20), to: at(30) },
    ]);
  });

  it("незакрытый проход, сброшенный доработкой раньше стоящего этапа, кончается моментом сброса", () => {
    const reviewing = start(done(start(EMPTY_PROGRESS, "prototype", 0), "prototype", 10), "spec", 12);
    const back = start(reviewing, "prototype", 15);
    expect(back.stages.spec?.passes).toEqual([{ from: at(12), to: at(15) }]);
    expect(stageTimeline(back, STAGES).find((s) => s.id === "spec")?.passes).toEqual([{ from: at(12), to: at(15) }]);
  });

  it("у доработанного этапа — проход на каждое начало, идущий проход без конца", () => {
    const timeline = stageTimeline(reworked(), STAGES);
    expect(timeline.find((s) => s.id === "prototype")?.passes).toEqual([
      { from: at(0), to: at(10) },
      { from: at(20), to: at(30) },
    ]);
    expect(timeline.find((s) => s.id === "demo")?.passes).toEqual([
      { from: at(10), to: at(20) },
      { from: at(30), to: null },
    ]);
  });

  it("этап без начала в шкалу не попадает — ни невзятый, ни закрытый без отметки о старте", () => {
    const closedOnly: FlowProgress = { ...EMPTY_PROGRESS, stages: { questions: { finishedAt: at(1) }, spec: { skipped: true } } };
    expect(stageTimeline(closedOnly, STAGES)).toEqual([]);
  });

  it("этапы идут в порядке flow, а не в порядке времени", () => {
    const progress: FlowProgress = { ...EMPTY_PROGRESS, stages: { spec: { startedAt: at(1) }, questions: { startedAt: at(5), finishedAt: at(6) } } };
    expect(stageTimeline(progress, STAGES).map((s) => s.id)).toEqual(["questions", "spec"]);
  });

  it("значок — свой значок этапа, а запасной — по виду, исполнителю и шагам", () => {
    const progress: FlowProgress = {
      ...EMPTY_PROGRESS,
      stages: { questions: { startedAt: at(0) }, prototype: { startedAt: at(1) }, spec: { startedAt: at(2), executor: "agent:planner" }, commit: { startedAt: at(3) } },
    };
    expect(stageTimeline(progress, STAGES).map(({ id, icon, fallbackIcon }) => ({ id, icon, fallbackIcon }))).toEqual([
      { id: "questions", icon: undefined, fallbackIcon: KIND_ICONS.questions },
      { id: "prototype", icon: "Album01", fallbackIcon: EXECUTOR_ICONS.self },
      { id: "spec", icon: undefined, fallbackIcon: EXECUTOR_ICONS.agent },
      { id: "commit", icon: undefined, fallbackIcon: AUTOMATION_ICON },
    ]);
  });
});
