// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { reportIssues } from "./core/stages";
import { FULL_FLOW } from "./core/stages-fixtures";
import { askDecisionParamsSchema } from "./shared/contract";

const read = (file: string) => readFileSync(new URL(`./skills/${file}`, import.meta.url), "utf8");
const skill = read("flow/SKILL.md");
const demo = read("flow-demo/SKILL.md");
const examples = ["flow-stage-selection/SKILL.md", "flow-stage-selection/ru.md"].flatMap((file) => [...read(file).matchAll(/```json\n([\s\S]*?)```/g)].map((m) => askDecisionParamsSchema.parse(JSON.parse(m[1] ?? ""))));

describe("навык Flow и виды этапов", () => {
  it("пример брифа присылает этапы полного flow с исполнителями плана и ревью без ошибок инструмента", () => {
    const staged = examples.filter((e) => e.setup?.stages !== undefined);
    expect(staged.length).toBeGreaterThan(0);
    const withAgents = FULL_FLOW.map((stage) =>
      stage.id === "plan" || stage.id === "review" ? { ...stage, executors: [{ id: stage.id === "plan" ? "agent:planner" : "agent:reviewer", kind: "agent" as const, name: stage.id === "plan" ? "planner" : "reviewer" }] } : stage,
    );
    for (const example of staged) expect(reportIssues(withAgents, example.setup?.stages)).toEqual([]);
  });

  it("навык объясняет виды этапов, Демонстрацию, правило flow и передачу соседнему треду, а Review by User не упоминает", () => {
    for (const word of ["## Stages and their skills", "Stage selection", "setup.stages", "only through its stages", "`clarify` brief", "rework", "new-thread composer", "## Where the work runs", "sibling of this one, not its child"]) expect(skill).toContain(word);
    for (const word of ["\"final\"", "\"pending\"", "documentsOnly"]) expect(demo).toContain(word);
    expect(skill).not.toMatch(/Review by User|"state": "review"|new worktree/);
  });
});

describe("навык flow — как идти по flow, а формат частей брифа — в навыках этапов", () => {
  it("называет навык каждого встроенного этапа, а из примеров держит только уточнение", () => {
    for (const name of ["flow-questions", "flow-criteria", "flow-stage-selection", "flow-demo"]) expect(skill).toContain(`\`${name}\``);
    const own = [...skill.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => askDecisionParamsSchema.parse(JSON.parse(m[1] ?? "")));
    expect(own.map((example) => example.kind)).toEqual(["clarify"]);
  });

  it("говорит, где лежат данные прогона и куда смотреть", () => {
    for (const place of ["docs/flows/", "docs/tasks/done/", "read_flows", "flow_stage"]) expect(skill).toContain(place);
  });
});
