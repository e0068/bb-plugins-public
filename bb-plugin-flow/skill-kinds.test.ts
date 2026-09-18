// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DEFAULT_STAGES } from "./core/flows";
import { reportIssues } from "./core/stages";
import { askDecisionParamsSchema } from "./shared/contract";

const skill = readFileSync(new URL("./skills/flow/SKILL.md", import.meta.url), "utf8");
const examples = [...skill.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => askDecisionParamsSchema.parse(JSON.parse(m[1] ?? "")));

describe("навык Flow и виды этапов", () => {
  it("пример брифа присылает этапы flow по умолчанию с исполнителями плана и ревью без ошибок инструмента", () => {
    const staged = examples.filter((e) => e.setup?.stages !== undefined);
    expect(staged.length).toBeGreaterThan(0);
    const withAgents = DEFAULT_STAGES.map((stage) =>
      stage.id === "plan" || stage.id === "review" ? { ...stage, executors: [{ id: stage.id === "plan" ? "agent:planner" : "agent:reviewer", kind: "agent" as const, name: stage.id === "plan" ? "planner" : "reviewer" }] } : stage,
    );
    for (const example of staged) expect(reportIssues(withAgents, example.setup?.stages)).toEqual([]);
  });

  it("навык объясняет виды этапов, Демонстрацию, правило flow и передачу соседнему треду, а Review by User не упоминает", () => {
    for (const word of ["## Work stages and stage kinds", "## Demo", "Stage selection", "setup.stages", "only through its stages", "`clarify` brief", "rework", "new-thread composer", "## Where the work runs", "\"final\"", "\"pending\"", "sibling of this one, not its child"]) expect(skill).toContain(word);
    expect(skill).not.toMatch(/Review by User|"state": "review"|new worktree/);
  });
});
