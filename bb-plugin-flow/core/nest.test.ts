// @vitest-environment node
// Этапы вложенного flow: строка flow собирает их под собой, номера идут с точкой — 2, 2.1, 2.2, а под-этапы номера не получают.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { Flow, WorkStage } from "../shared/contract";
import { expandStages } from "./flows";
import { nestTree, stagePlaces } from "./nest";
import { stage } from "./stages-fixtures";

const ref = (id: string, flowId: string): WorkStage => ({ id, kind: "skill", skill: "", name: id, executors: [], flowId });
const flow = (id: string, stages: WorkStage[], icon?: string): Flow => ({ id, name: id.toUpperCase(), stages, ...(icon === undefined ? {} : { icon }) });

const BRIEF = flow("brief", [stage("questions"), stage("demo", { parent: "proto" }), stage("proto")], "Album01");
const OUTER = flow("outer", [stage("plugin"), ref("nested", "brief"), stage("spec")]);
const EXPANDED = expandStages([OUTER, BRIEF], OUTER);

describe("expandStages: отметка вложенного flow", () => {
  it("этап вложенного flow несёт строку flow: её id, название и иконку flow", () => {
    expect(EXPANDED.find((s) => s.id === "nested.questions")?.nest).toEqual([{ id: "nested", name: "BRIEF", icon: "Album01" }]);
  });

  it("этап самого flow отметки не несёт", () => {
    expect(EXPANDED.find((s) => s.id === "plugin")?.nest).toBeUndefined();
  });

  it("вложенный глубже несёт цепочку строк от внешней к внутренней, с id развёрнутого списка", () => {
    const leaf = flow("leaf", [stage("a")]);
    const middle = flow("middle", [ref("m", "leaf")]);
    const outer = flow("outer", [ref("o", "middle")]);
    expect(expandStages([outer, middle, leaf], outer)[0]?.nest).toEqual([
      { id: "o", name: "MIDDLE" },
      { id: "o.m", name: "LEAF" },
    ]);
  });
});

describe("nestTree", () => {
  it("этапы вложенного flow встают одним узлом flow на месте первого из них", () => {
    const tree = nestTree(EXPANDED);
    expect(tree.map((node) => (node.kind === "stage" ? node.stage.id : node.flow.id))).toEqual(["plugin", "nested", "spec"]);
  });

  it("узел flow держит все свои этапы, под-этапы тоже, в порядке списка", () => {
    const node = nestTree(EXPANDED)[1];
    expect(node?.kind === "flow" && node.stages.map((s) => s.id)).toEqual(["nested.questions", "nested.demo", "nested.proto"]);
  });

  it("список без вложенных flow — одни этапы в том же порядке", () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.stringMatching(/^[a-z]{1,6}$/), { maxLength: 8 }), (names) => {
        const stages = names.map((n) => stage(n));
        expect(nestTree(stages)).toEqual(stages.map((s) => ({ kind: "stage", stage: s })));
      }),
    );
  });
});

describe("stagePlaces", () => {
  it("строка flow получает номер этапа верхнего уровня, её этапы — номер с точкой, следующий этап — номер после flow", () => {
    expect(Object.fromEntries(stagePlaces(EXPANDED))).toEqual({ plugin: "1", nested: "2", "nested.questions": "2.1", "nested.proto": "2.2", spec: "3" });
  });

  it("вложенный глубже нумеруется ещё одной точкой", () => {
    const leaf = flow("leaf", [stage("a"), stage("b")]);
    const middle = flow("middle", [stage("x"), ref("m", "leaf")]);
    const outer = flow("outer", [ref("o", "middle")]);
    expect(Object.fromEntries(stagePlaces(expandStages([outer, middle, leaf], outer)))).toEqual({ o: "1", "o.x": "1.1", "o.m": "1.2", "o.m.a": "1.2.1", "o.m.b": "1.2.2" });
  });

  it("не посчитанный этап номера не получает и не занимает место; flow без посчитанных этапов — тоже", () => {
    const skipped = new Set(["plugin", "nested.questions", "nested.proto"]);
    expect(Object.fromEntries(stagePlaces(EXPANDED, (s) => !skipped.has(s.id)))).toEqual({ spec: "1" });
  });

  it("без вложенных flow номер — место среди этапов верхнего уровня", () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.stringMatching(/^[a-z]{1,6}$/), { maxLength: 8 }), (names) => {
        const places = stagePlaces(names.map((n) => stage(n)));
        expect(names.map((n) => places.get(n))).toEqual(names.map((_, i) => String(i + 1)));
      }),
    );
  });
});
