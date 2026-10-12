import { describe, expect, it } from "vitest";
import { checkTree } from "./model";

// The compiler drops {{prev}} outside a pipeline stage and {{item}} outside an iterateOver template — the
// agent would get a prompt with a hole and no error. checkTree refuses such a tree instead, by node path.

const agent = (prompt: string) => ({ type: "agent", label: "a", agentType: "reviewer", prompt });

const problems = (tree: unknown): string[] => {
  const result = checkTree(tree);
  return result.ok ? [] : result.problems;
};

describe("placeholders in their scope", () => {
  it("{{prev}} in a pipeline stage and in a group nested in it is fine", () => {
    expect(
      problems({
        name: "w",
        phases: [{ title: "A", mode: "pipeline", steps: [agent("{{args}}"), agent("Review {{prev}}"), { type: "container", mode: "parallel", steps: [agent("Test {{prev}}"), agent("Lint {{prev}}")] }] }],
      }),
    ).toEqual([]);
  });

  it("{{prev}} in a phase of its own is refused — there is no previous stage across phases", () => {
    expect(problems({ name: "w", phases: [{ title: "A", steps: [agent("x")] }, { title: "B", mode: "parallel", steps: [agent("Review {{prev}}"), agent("y")] }] })).toEqual([
      "phases[1].steps[0].prompt: {{prev}} works only inside a pipeline stage — here it would be dropped",
    ]);
  });

  it("{{item}} only in the template of an iterateOver group inside a pipeline stage", () => {
    const tree = {
      name: "w",
      phases: [
        {
          title: "A",
          mode: "pipeline",
          steps: [agent("plan {{args}}"), { type: "container", mode: "parallel", iterateOver: "tasks", steps: [agent("do {{item}}")] }],
        },
      ],
    };
    expect(problems(tree)).toEqual([]);
    expect(problems({ name: "w", phases: [{ title: "A", steps: [agent("do {{item}}")] }] })).toEqual([
      "phases[0].steps[0].prompt: {{item}} works only in the first step of an iterateOver group — here it would be dropped",
    ]);
  });

  it("iterateOver outside a pipeline stage has nothing to iterate", () => {
    expect(problems({ name: "w", phases: [{ title: "A", mode: "parallel", iterateOver: "tasks", steps: [agent("do {{item}}")] }] })).toEqual([
      "phases[0].iterateOver: works only inside a pipeline stage — {{prev}}.tasks does not exist here",
    ]);
  });
});
