// @vitest-environment node
import { describe, expect, it } from "vitest";

import { flowDraftSchema, flowSchema, type FlowDraft, type StageCatalog } from "../shared/contract";
import { resolveFlowDraft } from "./flow-draft";
import { NO_FLOW } from "./flows";

const tester = { id: "agent:tester", kind: "agent" as const, name: "tester", model: "haiku", provider: "claude-code" };
const catalog: StageCatalog = { skills: [{ name: "task-flow" }, { name: "practice" }, { name: "spec" }], executors: [tester] };
const draft = (stages: FlowDraft["stages"], rest: Partial<FlowDraft> = {}): FlowDraft => flowDraftSchema.parse({ name: "General", stages, ...rest });
const resolve = (d: FlowDraft, c: StageCatalog = catalog) => resolveFlowDraft(d, c, () => "abc");
const problemsOf = (d: FlowDraft, c?: StageCatalog) => {
  const result = resolve(d, c);
  return result.ok ? [] : result.problems;
};

describe("черновик flow", () => {
  it("id «без flow» занят выбором композера и flow не достаётся", () => {
    expect(problemsOf(draft([{ kind: "questions" }], { id: NO_FLOW }))).toEqual([`the flow id "${NO_FLOW}" is reserved for the "no flow" choice of the composer`]);
    expect(resolve(draft([{ kind: "questions" }], { id: "quick" })).ok).toBe(true);
  });

  it("встроенные этапы получают id и английское название вида, этап-навык — id и название по навыку, исполнители — из каталога", () => {
    const result = resolve(draft([{ kind: "questions" }, { kind: "criteria" }, { kind: "skill", skill: "task-flow" }, { kind: "skill", skill: "practice", name: "Execution", executors: ["agent:tester"] }, { kind: "demo" }]));
    expect(result).toEqual({
      ok: true,
      flow: {
        id: "flow-abc",
        name: "General",
        stages: [
          { id: "questions", kind: "questions", skill: "", name: "Questions", executors: [] },
          { id: "criteria", kind: "criteria", skill: "", name: "Criteria", executors: [] },
          { id: "task-flow", kind: "skill", skill: "task-flow", name: "task-flow", executors: [] },
          { id: "practice", kind: "skill", skill: "practice", name: "Execution", executors: [tester] },
          { id: "demo", kind: "demo", skill: "", name: "Demonstration", executors: [] },
        ],
      },
    });
  });

  it("повторный встроенный вид и навык получают свободный id, заданный id и id flow сохраняются", () => {
    const result = resolve(draft([{ kind: "demo" }, { kind: "skill", skill: "spec" }, { kind: "skill", skill: "spec", id: "spec-2" }, { kind: "skill", skill: "spec" }, { kind: "demo" }], { id: "general" }));
    expect(result.ok && result.flow.id).toBe("general");
    expect(result.ok && result.flow.stages.map((s) => s.id)).toEqual(["demo", "spec", "spec-2", "spec-3", "demo-2"]);
  });

  it("автоматизация со скриптом становится этапом без навыка с id flow-automation", () => {
    const automation = { source: "flow" as const, steps: ["git.commit" as const, "script:lint" as const], scripts: [{ id: "lint", name: "lint.sh", content: "#!/bin/sh\nnpm run lint\n" }] };
    const result = resolve(draft([{ kind: "skill", name: "Lint and commit", automation }]));
    expect(result.ok && result.flow.stages).toEqual([{ id: "flow-automation", kind: "skill", skill: "", name: "Lint and commit", executors: [], automation }]);
    expect(result.ok && flowSchema.safeParse(result.flow).success).toBe(true);
  });

  it("навык и исполнитель не из каталога, этап-навык без навыка и автоматизации, шаг-скрипт без скрипта и повтор id — все проблемы сразу, с номером этапа", () => {
    const problems = problemsOf(
      draft([
        { kind: "skill", skill: "made-up" },
        { kind: "skill", skill: "spec", executors: ["agent:ghost"] },
        { kind: "skill", name: "Empty" },
        { kind: "skill", name: "Broken", automation: { source: "flow", steps: ["script:missing"] } },
        { kind: "questions", id: "same" },
        { kind: "criteria", id: "same" },
      ]),
    );
    expect(problems).toHaveLength(5);
    expect(problems[0]).toMatch(/stage 1.*made-up/);
    expect(problems[1]).toMatch(/stage 2.*agent:ghost/);
    expect(problems[2]).toMatch(/stage 3/);
    expect(problems[3]).toMatch(/stage 4.*missing/);
    expect(problems[4]).toMatch(/stage 6.*same/);
  });

  it("пустой каталог навыков — одна проблема про каталог, а не отказ каждому этапу", () => {
    const problems = problemsOf(draft([{ kind: "skill", skill: "spec" }, { kind: "skill", skill: "plan" }]), { skills: [], executors: [] });
    expect(problems).toEqual([expect.stringMatching(/catalog could not be read/)]);
  });

  it("автоматизация у встроенного этапа и исполнители у этапа-автоматизации — проблемы: Flow выполнил бы шаги вместо брифа", () => {
    const automation = { source: "flow" as const, steps: ["git.commit" as const] };
    const problems = problemsOf(draft([{ kind: "questions", automation }, { kind: "skill", automation, executors: ["agent:tester"] }]));
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/stage 1.*automation/);
    expect(problems[1]).toMatch(/stage 2.*executor/);
  });

  it("пустой каталог исполнителей при названных исполнителях — одна проблема про каталог", () => {
    const problems = problemsOf(draft([{ kind: "skill", skill: "spec", executors: ["agent:tester"] }]), { skills: catalog.skills, executors: [] });
    expect(problems).toEqual([expect.stringMatching(/executor catalog could not be read/)]);
  });

  it("схема черновика отбивает пустое имя, отрицательную позицию и неизвестный шаг", () => {
    expect(flowDraftSchema.safeParse({ name: " ", stages: [] }).success).toBe(false);
    expect(flowDraftSchema.safeParse({ name: "General", position: -1, stages: [] }).success).toBe(false);
    expect(flowDraftSchema.safeParse({ name: "General", stages: [{ kind: "skill", automation: { source: "flow", steps: ["git.push"] } }] }).success).toBe(false);
  });
});
