// @vitest-environment node
// Треды провайдеров в меню исполнителей: в сегменте агентов и группой «bb», а не среди агентов Codex (BBPL-965).
import { describe, expect, it } from "vitest";

import type { StageExecutor } from "../shared/contract";
import { executorGroups, inSegment } from "./catalog";
import { threadExecutor } from "./provider-threads";

const codexAgent: StageExecutor = { id: "agent:codex/coder", kind: "agent", name: "coder", provider: "codex" };
const codexThread = threadExecutor({ id: "codex", displayName: "Codex" });
const workflow: StageExecutor = { id: "workflow:lead-waves", kind: "workflow", name: "lead-waves" };

describe("тред провайдера в меню исполнителей", () => {
  it("сегмент агентов показывает агентов и треды, сегмент workflow — только workflow", () => {
    const all = [codexAgent, codexThread, workflow];
    expect(all.filter((e) => inSegment(e, "agent")).map((e) => e.id)).toEqual(["agent:codex/coder", "thread:codex"]);
    expect(all.filter((e) => inSegment(e, "workflow")).map((e) => e.id)).toEqual(["workflow:lead-waves"]);
  });

  it("тред Codex — в группе «bb», агент Codex — в группе Codex", () => {
    expect(executorGroups([codexAgent, codexThread]).map(({ group, executors }) => [group, executors.map((e) => e.id)])).toEqual([
      [{ kind: "plugin", plugin: "bb" }, ["thread:codex"]],
      [{ kind: "codex" }, ["agent:codex/coder"]],
    ]);
  });
});
