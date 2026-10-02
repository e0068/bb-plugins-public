import { describe, expect, it } from "vitest";

import type { BuiltinAutomation } from "../shared/contract";
import { applySet, removeSet } from "./automation-sets";

const withScript: BuiltinAutomation = { source: "flow", steps: ["git.create-pr", "script:a"], scripts: [{ id: "a", name: "deploy.sh", content: "echo hi" }] };

const ids = (n = 0) => () => `new${++n}`;

describe("наборы автоматизаций", () => {
  it("сохранённый набор ставится в автоматизацию с новыми id скриптов, шаги в том же порядке", () => {
    const set = { steps: withScript.steps, scripts: withScript.scripts };
    expect(applySet(set, ids())).toEqual({ source: "flow", steps: ["git.create-pr", "script:new1"], scripts: [{ id: "new1", name: "deploy.sh", content: "echo hi" }] });
    expect(applySet({ steps: ["git.merge"] }, ids())).toEqual({ source: "flow", steps: ["git.merge"] });
  });

  it("набор удаляется по номеру, остальные на месте", () => {
    expect(removeSet([{ steps: ["git.create-pr"] }, { steps: ["git.merge"] }], 0)).toEqual([{ steps: ["git.merge"] }]);
  });
});
