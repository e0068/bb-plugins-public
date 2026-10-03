// @vitest-environment node
// Встроенный этап без навыка — метка NO_SKILL: save_flow принимает её, как её отдаёт read_flows.
import { describe, expect, it } from "vitest";

import { builtinStage, NO_SKILL } from "../lib/stage-constants";
import { flowDraftSchema, type Flow, type FlowDraft, type StageCatalog } from "../shared/contract";
import { resolveFlowDraft } from "./flow-draft";

const catalog: StageCatalog = { skills: [{ name: "git-hygiene" }], executors: [] };
const draft = (stages: FlowDraft["stages"], id?: string): FlowDraft => flowDraftSchema.parse({ name: "General", stages, ...(id === undefined ? {} : { id }) });

describe("встроенный этап без навыка в черновике flow", () => {
  it("новый flow принимает метку и хранит её", () => {
    const result = resolveFlowDraft(draft([{ kind: "questions", skill: NO_SKILL }]), catalog, () => "abc");
    expect(result.ok && result.flow.stages[0]).toMatchObject({ kind: "questions", skill: NO_SKILL });
  });

  it("пересохранение flow с меткой проходит", () => {
    const stored: Flow = { id: "quick", name: "Quick", stages: [{ ...builtinStage("demo", []), skill: NO_SKILL }] };
    const result = resolveFlowDraft(draft([{ id: "demo", kind: "demo", skill: NO_SKILL }], "quick"), catalog, () => "abc", stored);
    expect(result.ok && result.flow.stages[0]?.skill).toBe(NO_SKILL);
  });

  it("у этапа навыка метка — навык не из каталога", () => {
    const result = resolveFlowDraft(draft([{ kind: "skill", skill: NO_SKILL, name: "Commit", automation: { source: "flow", steps: ["git.commit"] } }]), catalog, () => "abc");
    expect(result.ok ? [] : result.problems).toEqual([`stage 1: the skill "${NO_SKILL}" is not in the catalog`]);
  });
});

describe("навык этапа со шагами без прочитанного каталога", () => {
  it("черновик отклоняется, как с навыком любого этапа", () => {
    const result = resolveFlowDraft(draft([{ kind: "skill", skill: "git-hygiene", name: "Commit", automation: { source: "flow", steps: ["git.commit"] } }]), { skills: [], executors: [] }, () => "abc");
    expect(result.ok).toBe(false);
  });
});
