// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionBrief, WorkStage } from "../shared/contract";
import { EMPTY_PROGRESS, onAnswer, onBrief, onMark, progressView } from "./progress";
import { planner, report, stage } from "./stages-fixtures";

const STAGES: WorkStage[] = [
  builtinStage("questions", []),
  builtinStage("select", []),
  stage("task", { name: "Задача" }),
  stage("plan", { name: "План", executors: [planner] }),
  builtinStage("demo", []),
];

const T0 = "2026-09-16T10:00:00.000Z";
const T1 = "2026-09-16T10:05:00.000Z";
const T2 = "2026-09-16T10:17:00.000Z";

const brief = (patch: Partial<DecisionBrief>): DecisionBrief => ({ id: "dec_1", threadId: "thr_1", title: "Бриф", createdAt: T0, kind: "brief", questions: [], stages: { list: STAGES, minButtonWidth: 170 }, ...patch });

const first = brief({ setup: { stages: [report("questions"), report("select"), report("task", { recommended: true }), report("plan"), report("demo", { recommended: true })] } });

const states = (view: ReturnType<typeof progressView>) => view.stages.map((s) => s.state);

describe("прогресс flow", () => {
  it("бриф ставит ведущие Вопросы и Выбор этапов ждать ответа", () => {
    const view = progressView(onBrief(EMPTY_PROGRESS, first, T0), STAGES);
    expect(states(view)).toEqual(["now", "now", "todo", "todo", "todo"]);
    expect(view.current).toBe("questions");
    expect(view).toMatchObject({ done: 0, total: 5 });
  });

  it("ответ закрывает ждущие этапы, снимает этапы вне прогона, помнит исполнителя и план", () => {
    const answer = { briefId: first.id, answers: [], stages: [{ id: "task", run: true, executor: "self" }, { id: "plan", run: false, executor: "self" }, { id: "demo", run: true, executor: "self" }] };
    const progress = onAnswer(onBrief(EMPTY_PROGRESS, first, T0), first, answer, T1, { minutes: 200, target: 48, max: 96 });
    const view = progressView(progress, STAGES);
    expect(states(view)).toEqual(["done", "done", "todo", "skip", "todo"]);
    expect(view.current).toBe("task");
    expect(view.planned).toEqual({ minutes: 200, target: 48, max: 96 });
    expect(view.stages[0]!.minutes).toBe(5);
  });

  it("отметки агента: начатый этап идёт, законченный сделан со ссылками, минутами и стоимостью", () => {
    const started = onMark(EMPTY_PROGRESS, "task", "started", T1);
    expect(progressView(started, STAGES).stages[2]).toMatchObject({ state: "now", minutes: null });
    const link = { label: "task.md", target: "docs/tasks/task.md" };
    const done = progressView(onMark(started, "task", "done", T2, [link], 1.8), STAGES).stages[2];
    expect(done).toMatchObject({ state: "done", minutes: 12, cost: 1.8, results: [link] });
  });

  it("исполнитель этапа — сам, агент или workflow по выбору владельца", () => {
    const answer = { briefId: first.id, answers: [], stages: [{ id: "plan", run: true, executor: planner.id }] };
    const view = progressView(onAnswer(EMPTY_PROGRESS, first, answer, T1), STAGES);
    expect(view.stages.map((s) => s.executor)).toEqual(["self", "self", "self", "agent", "self"]);
    expect(progressView(onAnswer(EMPTY_PROGRESS, first, { ...answer, stages: [{ id: "plan", run: true, executor: "workflow:DEV2" }] }, T1), STAGES).stages[3]!.executor).toBe("workflow");
  });

  it("Демонстрация ждёт ответа; «на доработку» оставляет её идущей, «продолжить» — закрывает", () => {
    const demo = brief({ outcome: { stage: "demo", final: true, done: ["Сделано"], pending: [], results: [{ label: "a", target: "a" }] } });
    const waiting = onBrief(EMPTY_PROGRESS, demo, T1);
    expect(progressView(waiting, STAGES).stages[4]!.state).toBe("now");
    const rework = onAnswer(waiting, demo, { briefId: demo.id, answers: [], outcome: { accepted: false, note: "ещё" } }, T2);
    expect(progressView(rework, STAGES).stages[4]!.state).toBe("now");
    const accepted = onAnswer(waiting, demo, { briefId: demo.id, answers: [], outcome: { accepted: true } }, T2);
    expect(progressView(accepted, STAGES).stages[4]!.state).toBe("done");
  });

  it("сделанный по отчёту брифа этап получает ссылки", () => {
    const link = { label: "plan.md", target: "plan.md" };
    const later = brief({ setup: { stages: [report("questions", { state: "done" }), report("select", { state: "done" }), report("task", { state: "done", results: [link] }), report("plan"), report("demo")] } });
    expect(progressView(onBrief(EMPTY_PROGRESS, later, T2), STAGES).stages[2]).toMatchObject({ state: "done", results: [link] });
  });

  it("этап, которого во flow больше нет, в вид не попадает; счёт сходится", () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.constantFrom("questions", "select", "task", "plan", "demo", "ghost"), fc.constantFrom("started", "done") as fc.Arbitrary<"started" | "done">), { maxLength: 10 }), (marks) => {
        const progress = marks.reduce((p, [id, state]) => onMark(p, id, state, T1), EMPTY_PROGRESS);
        const view = progressView(progress, STAGES);
        expect(view.stages.map((s) => s.id)).toEqual(STAGES.map((s) => s.id));
        expect(view.total).toBe(STAGES.length);
        expect(view.done).toBe(view.stages.filter((s) => s.state === "done").length);
      }),
    );
  });
});
