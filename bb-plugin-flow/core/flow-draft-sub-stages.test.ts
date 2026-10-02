// @vitest-environment node
import { describe, expect, it } from "vitest";

import { flowDraftSchema, type FlowDraft, type StageCatalog } from "../shared/contract";
import { resolveFlowDraft } from "./flow-draft";

const catalog: StageCatalog = { skills: [{ name: "spec" }], executors: [] };
const preview = { id: "preview", kind: "skill" as const, automation: { source: "flow" as const, steps: ["git.commit" as const] } };
const draft = (stages: FlowDraft["stages"]): FlowDraft => flowDraftSchema.parse({ name: "BB Plugin", stages });
const resolve = (stages: FlowDraft["stages"]) => resolveFlowDraft(draft(stages), catalog, () => "abc");

describe("под-этапы в черновике save_flow", () => {
  it("владелец под-этапа доезжает до сохранённого flow", () => {
    const result = resolve([{ ...preview, parent: "demo" }, { id: "demo", kind: "demo" }]);
    expect(result.ok && result.flow.stages.map((s) => [s.id, s.parent ?? null])).toEqual([["preview", "demo"], ["demo", null]]);
  });

  it("разорванная связка отклоняется понятной причиной", () => {
    const result = resolve([{ ...preview, parent: "demo" }, { kind: "skill", skill: "spec" }, { id: "demo", kind: "demo" }]);
    expect(result).toEqual({ ok: false, problems: ["a sub-stage stands next to its parent, a top-level stage of the same flow, with only that parent's sub-stages between them"] });
  });
});
