import { describe, expect, it } from "vitest";

import type { BuiltinAutomation } from "../shared/contract";
import { applySet, removeSet, saveSet } from "./automation-sets";

const pr: BuiltinAutomation = { source: "flow", steps: ["git.create-pr", "git.merge"] };
const withScript: BuiltinAutomation = { source: "flow", steps: ["git.create-pr", "script:a"], scripts: [{ id: "a", name: "deploy.sh", content: "echo hi" }] };

const ids = (n = 0) => () => `new${++n}`;

describe("наборы автоматизаций", () => {
  it("набор сохраняется шагами и скриптами автоматизации, в конец списка", () => {
    expect(saveSet([], pr)).toEqual([{ steps: ["git.create-pr", "git.merge"] }]);
    expect(saveSet([{ steps: ["git.merge"] }], withScript)).toEqual([{ steps: ["git.merge"] }, { steps: ["git.create-pr", "script:a"], scripts: [{ id: "a", name: "deploy.sh", content: "echo hi" }] }]);
  });

  it("тот же набор второй раз не сохраняется — список тот же", () => {
    const sets = saveSet([], withScript);
    const again: BuiltinAutomation = { source: "flow", steps: ["git.create-pr", "script:b"], scripts: [{ id: "b", name: "deploy.sh", content: "echo hi" }] };
    expect(saveSet(sets, again)).toBe(sets);
  });

  it("автоматизация без шагов не сохраняется", () => {
    const sets = [{ steps: ["git.merge" as const] }];
    expect(saveSet(sets, { source: "flow", steps: [] })).toBe(sets);
  });

  it("набор ставится в автоматизацию с новыми id скриптов, шаги в том же порядке", () => {
    const [set] = saveSet([], withScript);
    expect(applySet(set!, ids())).toEqual({ source: "flow", steps: ["git.create-pr", "script:new1"], scripts: [{ id: "new1", name: "deploy.sh", content: "echo hi" }] });
    expect(applySet({ steps: ["git.merge"] }, ids())).toEqual({ source: "flow", steps: ["git.merge"] });
  });

  it("набор удаляется по номеру, остальные на месте", () => {
    expect(removeSet([{ steps: ["git.create-pr"] }, { steps: ["git.merge"] }], 0)).toEqual([{ steps: ["git.merge"] }]);
  });
});
