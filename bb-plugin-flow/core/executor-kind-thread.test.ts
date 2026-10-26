// @vitest-environment node
// Баннер прогона: этап, отданный дочернему треду провайдера, помечен как ведомый агентом, а не самим тредом (BBPL-965).
import { describe, expect, it } from "vitest";

import { executorKind } from "./automation-run";

describe("вид исполнителя в баннере", () => {
  it("тред провайдера — агент; агент, workflow и сам — как были", () => {
    expect(executorKind("thread:codex")).toBe("agent");
    expect(executorKind("agent:implementer")).toBe("agent");
    expect(executorKind("workflow:lead-waves")).toBe("workflow");
    expect(executorKind("self")).toBe("self");
    expect(executorKind(undefined)).toBe("self");
  });
});
