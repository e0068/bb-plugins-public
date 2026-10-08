// @vitest-environment node
// «Преобразовать во Flow»: этап со своими под-этапами уезжает в новый flow, а на его месте встаёт строка «Flow» нового flow.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { Flow, FlowSettings, WorkStage } from "../shared/contract";
import { expandStages, stageToFlow, stageToFlowProblem } from "./flows";
import { stage } from "./stages-fixtures";

const flow = (id: string, stages: WorkStage[]): Flow => ({ id, name: id.toUpperCase(), stages });
const settingsOf = (...flows: Flow[]): FlowSettings => ({ flows, minButtonWidth: 170 });
const ids = (stages: readonly WorkStage[]) => stages.map((s) => s.id);
const MADE = { id: "made", name: "Демо" };
const LINKED = [stage("ship"), stage("preview", { parent: "demo" }), stage("demo"), stage("restore", { parent: "demo" }), stage("merge")];

describe("stageToFlow", () => {
  it("новый flow встаёт в конец списка с именем и id из аргумента и этапом со всеми под-этапами", () => {
    const after = stageToFlow(settingsOf(flow("plugin", LINKED), flow("other", [stage("x")])), "plugin", "demo", MADE);
    expect(after.flows.map((f) => f.id)).toEqual(["plugin", "other", "made"]);
    const made = after.flows[2]!;
    expect(made.name).toBe("Демо");
    expect(made.stages).toEqual([LINKED[1], LINKED[2], LINKED[3]]);
  });

  it("на месте связки в исходном flow — одна строка «Flow» нового flow, остальные этапы на своих местах", () => {
    const after = stageToFlow(settingsOf(flow("plugin", LINKED)), "plugin", "demo", MADE);
    const stages = after.flows[0]!.stages;
    expect(stages.map((s) => s.flowId)).toEqual([undefined, "made", undefined]);
    expect(stages[1]!.name).toBe("Демо");
    expect([stages[0], stages[2]]).toEqual([LINKED[0], LINKED[4]]);
  });

  it("прогон исходного flow проходит те же этапы в том же порядке", () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.stringMatching(/^[a-z]{1,6}$/), { minLength: 1, maxLength: 8 }), fc.nat(), (names, pick) => {
        const own = flow("plugin", names.map((n) => stage(n)));
        const target = names[pick % names.length]!;
        const after = stageToFlow(settingsOf(own), "plugin", target, MADE);
        const expanded = expandStages(after.flows, after.flows[0]!).map((s) => s.skill);
        expect(expanded).toEqual(names);
      }),
    );
  });

  it("под-этап, строка «Flow», неизвестный этап и неизвестный flow оставляют коллекцию как есть", () => {
    const nested = stage("nested", { skill: "", flowId: "other" });
    const before = settingsOf(flow("plugin", [...LINKED, nested]), flow("other", [stage("x")]));
    expect(stageToFlow(before, "plugin", "preview", MADE)).toBe(before);
    expect(stageToFlow(before, "plugin", "nested", MADE)).toBe(before);
    expect(stageToFlow(before, "plugin", "missing", MADE)).toBe(before);
    expect(stageToFlow(before, "missing", "demo", MADE)).toBe(before);
  });
});

const chain = (id: string, steps: string[]): WorkStage => stage(id, { skill: "", automation: { source: "flow", steps: steps as never } });

describe("stageToFlowProblem", () => {
  it("этап с мёрджем, чей PR открывает этап выше, во Flow не выносится: новый flow начался бы с мёрджа без PR", () => {
    const own = settingsOf(flow("plugin", [chain("open", ["git.commit", "git.create-pr"]), chain("merge", ["git.merge"])]));
    expect(stageToFlowProblem(own, "plugin", "merge")?.step).toBe("git.merge");
  });

  it("этап, который сам открывает PR и мёрджит, и обычный этап выносятся без помех", () => {
    const own = settingsOf(flow("plugin", [stage("implement"), chain("ship", ["git.create-pr", "git.merge"])]));
    expect(stageToFlowProblem(own, "plugin", "ship")).toBeNull();
    expect(stageToFlowProblem(own, "plugin", "implement")).toBeNull();
  });

  it("этап, который не выносится вовсе, проблемы не даёт", () => {
    expect(stageToFlowProblem(settingsOf(flow("plugin", LINKED)), "plugin", "preview")).toBeNull();
  });
});
