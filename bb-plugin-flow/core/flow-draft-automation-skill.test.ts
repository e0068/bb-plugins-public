// @vitest-environment node
// Навык — поле любого этапа: этап со шагами из черновика агента его не теряет.
import { describe, expect, it } from "vitest";

import { flowDraftSchema, type FlowDraft, type StageCatalog } from "../shared/contract";
import { resolveFlowDraft } from "./flow-draft";

const catalog: StageCatalog = { skills: [{ name: "git-hygiene" }], executors: [] };
const draft = (stages: FlowDraft["stages"]): FlowDraft => flowDraftSchema.parse({ name: "General", stages });
const commit = { source: "flow" as const, steps: ["git.commit" as const] };

describe("навык этапа со шагами в черновике flow", () => {
  it("остаётся у этапа", () => {
    const result = resolveFlowDraft(draft([{ kind: "skill", skill: "git-hygiene", name: "Commit", automation: commit }]), catalog, () => "abc");
    expect(result.ok && result.flow.stages[0]).toMatchObject({ skill: "git-hygiene", automation: commit });
  });

  it("навык не из каталога — проблема черновика, как у любого этапа", () => {
    const result = resolveFlowDraft(draft([{ kind: "skill", skill: "missing", name: "Commit", automation: commit }]), catalog, () => "abc");
    expect(result.ok ? [] : result.problems).toEqual(['stage 1: the skill "missing" is not in the catalog']);
  });
});
