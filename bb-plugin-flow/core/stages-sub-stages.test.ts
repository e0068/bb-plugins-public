// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { WorkStage } from "../shared/contract";
import { stageInstructions } from "./stages";

const automation = (id: string, name: string, parent?: string): WorkStage => ({
  id,
  kind: "skill",
  skill: "",
  name,
  executors: [],
  automation: { source: "flow", steps: ["git.commit"] },
  ...(parent === undefined ? {} : { parent }),
});

const STAGES: WorkStage[] = [
  { id: "spec", kind: "skill", skill: "spec", name: "Spec", executors: [] },
  automation("preview", "Preview", "demo"),
  { id: "demo", kind: "demo", skill: "flow-demo", name: "Demonstration", executors: [] },
  automation("restore", "Restore", "demo"),
  automation("merge", "Merge"),
];

describe("под-этапы в инструкциях агенту", () => {
  const lines = stageInstructions(STAGES)!.split("\n").slice(1);

  it("номер только у этапов верхнего уровня", () => {
    expect(lines.map((line) => line.match(/^(\d+)\. (\S+)/)?.slice(1, 3) ?? line.match(/^ {3}- (\S+)/)?.[1])).toEqual([["1", "spec"], "preview", ["2", "demo"], "restore", ["3", "merge"]]);
  });

  it("под-этап называет владельца, место и общую галочку, а остальное — как у своего вида", () => {
    expect(lines[1]).toContain('preview "Preview" — sub-stage of demo, runs before it, switched on and off together with it');
    expect(lines[3]).toContain("sub-stage of demo, runs after it");
    expect(lines[3]).toContain("automation: Flow runs this stage by itself");
  });
});
