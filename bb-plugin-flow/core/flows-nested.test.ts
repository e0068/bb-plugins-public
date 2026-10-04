// @vitest-environment node
// Этап «Flow»: строка с `flowId` при чтении flow превращается в этапы вложенного flow на своём месте.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { Flow, FlowSettings, WorkStage } from "../shared/contract";
import { expandStages, flowCycle, flowStage, includesFlow, nestableFlows, stageSettingsOf, withExpandedStages } from "./flows";
import { stage } from "./stages-fixtures";

const ref = (id: string, flowId: string, patch: Partial<WorkStage> = {}): WorkStage => ({ id, kind: "skill", skill: "", name: id, executors: [], flowId, ...patch });
const flow = (id: string, stages: WorkStage[]): Flow => ({ id, name: id.toUpperCase(), stages });
const ids = (stages: readonly WorkStage[]) => stages.map((s) => s.id);

describe("expandStages", () => {
  it("flow без строк «Flow» возвращает свои этапы как есть", () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.stringMatching(/^[a-z]{1,6}$/), { maxLength: 8 }), (names) => {
        const own = flow("outer", names.map((n) => stage(n)));
        expect(expandStages([own], own)).toEqual(own.stages);
      }),
    );
  });

  it("строка встаёт этапами вложенного flow на своём месте, с префиксом id строки", () => {
    const inner = flow("answer", [stage("project"), stage("demo")]);
    const outer = flow("plugin", [stage("task"), ref("nested", "answer"), stage("ship")]);
    expect(ids(expandStages([outer, inner], outer))).toEqual(["task", "nested.project", "nested.demo", "ship"]);
  });

  it("название и навык вложенных этапов не меняются", () => {
    const inner = flow("answer", [stage("project", { skill: "project-docs", name: "Project" })]);
    const outer = flow("plugin", [ref("nested", "answer")]);
    expect(expandStages([outer, inner], outer)[0]).toMatchObject({ id: "nested.project", skill: "project-docs", name: "Project" });
  });

  it("владелец под-этапа получает тот же префикс, что и сам под-этап", () => {
    const inner = flow("answer", [stage("preview", { parent: "demo" }), stage("demo")]);
    const outer = flow("plugin", [ref("nested", "answer")]);
    expect(expandStages([outer, inner], outer).map((s) => [s.id, s.parent])).toEqual([["nested.preview", "nested.demo"], ["nested.demo", undefined]]);
  });

  it("один flow, включённый дважды, даёт разные id", () => {
    const inner = flow("answer", [stage("project")]);
    const outer = flow("plugin", [ref("first", "answer"), ref("second", "answer")]);
    expect(ids(expandStages([outer, inner], outer))).toEqual(["first.project", "second.project"]);
  });

  it("вложенность глубже одного уровня разворачивается целиком", () => {
    const leaf = flow("leaf", [stage("a")]);
    const middle = flow("middle", [ref("m", "leaf"), stage("b")]);
    const outer = flow("outer", [ref("o", "middle")]);
    expect(ids(expandStages([outer, middle, leaf], outer))).toEqual(["o.m.a", "o.b"]);
  });

  it("удалённый или неизвестный flow даёт ноль этапов, соседние этапы остаются", () => {
    const outer = flow("plugin", [stage("task"), ref("gone", "missing"), stage("ship")]);
    expect(ids(expandStages([outer], outer))).toEqual(["task", "ship"]);
  });

  it("цикл не вешает чтение: повтор flow в цепочке даёт ноль этапов", () => {
    const a = flow("a", [stage("x"), ref("to-b", "b")]);
    const b = flow("b", [stage("y"), ref("to-a", "a")]);
    expect(ids(expandStages([a, b], a))).toEqual(["x", "to-b.y"]);
  });

  it("на графах без циклов число этапов — сумма по строкам, а id уникальны", () => {
    // flow i ссылается только на flow с меньшим номером: цикла быть не может
    const graph = fc.array(fc.array(fc.option(fc.nat(), { nil: undefined }), { maxLength: 4 }), { minLength: 1, maxLength: 6 });
    fc.assert(
      fc.property(graph, (shape) => {
        const flows = shape.map((row, i) => flow(`f${i}`, row.map((target, j) => (target === undefined || i === 0 ? stage(`s${j}`) : ref(`r${j}`, `f${target % i}`)))));
        const count = (f: Flow): number => f.stages.reduce((n, s) => n + (s.flowId === undefined ? 1 : count(flows.find((x) => x.id === s.flowId)!)), 0);
        const last = flows[flows.length - 1]!;
        const expanded = expandStages(flows, last);
        expect(expanded).toHaveLength(count(last));
        expect(new Set(ids(expanded)).size).toBe(expanded.length);
      }),
    );
  });
});

describe("withExpandedStages", () => {
  it("каждый flow коллекции — с развёрнутыми этапами, остальные поля те же", () => {
    const inner = flow("answer", [stage("project")]);
    const outer = { ...flow("plugin", [stage("task"), ref("nested", "answer")]), description: "Когда брать" };
    const expanded = withExpandedStages([outer, inner]);
    expect(expanded.map((f) => [f.id, ids(f.stages)])).toEqual([["plugin", ["task", "nested.project"]], ["answer", ["project"]]]);
    expect(expanded[0]?.description).toBe("Когда брать");
  });
});

describe("flowCycle и includesFlow", () => {
  const plain = flow("plain", [stage("x")]);

  it("без циклов цепочка пуста", () => {
    expect(flowCycle([flow("a", [ref("r", "plain")]), plain])).toEqual([]);
  });

  it("flow, включивший сам себя, — цепочка из него и обратно", () => {
    expect(flowCycle([flow("a", [ref("r", "a")])])).toEqual(["a", "a"]);
  });

  it("цикл через цепочку других называет её целиком", () => {
    expect(flowCycle([flow("a", [ref("r", "b")]), flow("b", [ref("r", "c")]), flow("c", [ref("r", "a")])])).toEqual(["a", "b", "c", "a"]);
  });

  it("includesFlow видит вложенность транзитивно, без тождества", () => {
    const flows = [flow("a", [ref("r", "b")]), flow("b", [ref("r", "c")]), flow("c", [stage("x")])];
    expect(includesFlow(flows, "a", "c")).toBe(true);
    expect(includesFlow(flows, "c", "a")).toBe(false);
    expect(includesFlow(flows, "a", "a")).toBe(false);
  });

  it("цикл есть ровно тогда, когда какой-то flow достигает сам себя", () => {
    const graph = fc.array(fc.array(fc.option(fc.nat(), { nil: undefined }), { maxLength: 3 }), { minLength: 1, maxLength: 5 });
    fc.assert(
      fc.property(graph, (shape) => {
        const flows = shape.map((row, i) => flow(`f${i}`, row.map((target, j) => (target === undefined ? stage(`s${j}`) : ref(`r${j}`, `f${target % shape.length}`)))));
        const reachesItself = flows.some((f) => includesFlow(flows, f.id, f.id));
        expect(flowCycle(flows).length > 0).toBe(reachesItself);
      }),
    );
  });
});

describe("nestableFlows", () => {
  it("не предлагает сам flow и те, что включают его, остальные — в порядке коллекции", () => {
    const flows = [flow("plugin", [stage("task")]), flow("answer", [stage("x")]), flow("outer", [ref("r", "plugin")]), flow("code", [stage("y")])];
    expect(nestableFlows(flows, "plugin").map((f) => f.id)).toEqual(["answer", "code"]);
  });

  it("вложенный в открытый flow предлагается снова: замена на тот же flow допустима", () => {
    const flows = [flow("plugin", [ref("r", "answer")]), flow("answer", [stage("x")])];
    expect(nestableFlows(flows, "plugin").map((f) => f.id)).toEqual(["answer"]);
  });
});

describe("flowStage", () => {
  it("новая строка — этап навыка без навыка и исполнителей, с id flow и его названием", () => {
    expect(flowStage({ id: "answer", name: "Answer" }, [])).toEqual({ id: "nested-flow", kind: "skill", skill: "", name: "Answer", executors: [], flowId: "answer" });
  });

  it("id свободен среди занятых", () => {
    expect(flowStage({ id: "answer", name: "Answer" }, ["nested-flow"]).id).toBe("nested-flow-2");
  });
});

describe("stageSettingsOf", () => {
  it("отдаёт этапы с развёрнутыми строками и общую ширину кнопки", () => {
    const inner = flow("answer", [stage("project")]);
    const outer = flow("plugin", [stage("task"), ref("nested", "answer")]);
    const settings: FlowSettings = { flows: [outer, inner], minButtonWidth: 170 };
    const result = stageSettingsOf(settings, outer);
    expect(ids(result.stages)).toEqual(["task", "nested.project"]);
    expect(result.minButtonWidth).toBe(170);
  });
});
