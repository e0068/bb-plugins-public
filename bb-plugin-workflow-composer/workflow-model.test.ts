import { describe, it, expect } from "vitest";
import {
  compile,
  parse,
  readMetaDescription,
  blankTree,
  blankPhase,
  blankAgent,
  blankContainer,
  type Tree,
  type Agent,
  type Container,
} from "./workflow-model";

function agent(over: Partial<Agent> = {}): Agent {
  return { ...blankAgent(), ...over };
}

// A rich tree exercising every branch: pipeline + parallel phases, a nested container, all agent
// fields, a repeat budget, an inline schema.
function richTree(): Tree {
  return {
    name: "review-changes",
    description: "Review then verify",
    phases: [
      {
        title: "Review",
        mode: "pipeline",
        repeatBudget: null,
        steps: [
          agent({ label: "read", prompt: "Read {{prev}} carefully", model: "opus", effort: "high" }),
          agent({ label: "judge", prompt: "Judge it", agentType: "code-reviewer", schema: '{ "type": "object" }' }),
        ],
      },
      {
        title: "Verify",
        mode: "parallel",
        repeatBudget: 500000,
        steps: [
          agent({ prompt: "Verify A" }),
          blankContainer("pipeline"),
        ],
      },
    ],
  };
}

describe("compile", () => {
  it("emits meta, phases and the primitives", () => {
    const src = compile(richTree());
    expect(src).toContain("export const meta = {");
    expect(src).toContain('name: "review-changes"');
    expect(src).toContain('phase("Review")');
    expect(src).toContain('phase("Verify")');
    expect(src).toContain("pipeline([null],");
    expect(src).toContain("parallel([");
    expect(src).toContain("agent(");
  });

  it("claude engine inlines model/effort/agentType; empty fields omitted", () => {
    const src = compile(
      {
        name: "w",
        description: "d",
        phases: [{ title: "P", mode: "single", repeatBudget: null, steps: [agent({ label: "l", model: "opus", effort: "high", schema: "{ a: 1 }" })] }],
      },
      "claude",
    );
    expect(src).toContain('label: "l"');
    expect(src).toContain('model: "opus"');
    expect(src).toContain("effort: \"high\"");
    expect(src).toContain("schema: { a: 1 }");
    expect(src).not.toContain("agentType:"); // empty → omitted
  });

  it("bb engine emits only label/schema — no model/effort/agentType (they are rejected by bb) when provider is unset", () => {
    const body = compile(
      {
        name: "w",
        description: "d",
        phases: [{ title: "P", mode: "single", repeatBudget: null, steps: [agent({ label: "l", model: "opus", effort: "high", agentType: "x", schema: "{ a: 1 }" })] }],
      },
      "bb",
    ).split("/* @composer-workflow")[0];
    expect(body).toContain('label: "l"');
    expect(body).toContain("schema: { a: 1 }");
    expect(body).not.toContain("model:");
    expect(body).not.toContain("effort:");
    expect(body).not.toContain("agentType:");
  });

  it("bb engine emits the provider+model+reasoningLevel triple when all three are set", () => {
    const body = compile(
      {
        name: "w",
        description: "d",
        phases: [
          {
            title: "P",
            mode: "single",
            repeatBudget: null,
            steps: [agent({ label: "l", provider: "claude-code", model: "opus", effort: "high", agentType: "x", schema: "{ a: 1 }" })],
          },
        ],
      },
      "bb",
    ).split("/* @composer-workflow")[0];
    expect(body).toContain('label: "l"');
    expect(body).toContain('provider: "claude-code"');
    expect(body).toContain('model: "opus"');
    expect(body).toContain('reasoningLevel: "high"');
    expect(body).toContain("schema: { a: 1 }");
    expect(body).not.toContain("agentType:"); // bb has no agentType at all
  });

  it("wraps a budgeted phase in a while(budget) loop", () => {
    const src = compile({
      name: "w",
      description: "",
      phases: [{ title: "P", mode: "single", repeatBudget: 500000, steps: [agent({ prompt: "go" })] }],
    });
    expect(src).toContain("while (budget.total && budget.remaining() > 500000) {");
  });

  it("interpolates {{prev}} only inside a pipeline stage, drops it elsewhere", () => {
    const pipe = compile({
      name: "w",
      description: "",
      phases: [{ title: "P", mode: "pipeline", repeatBudget: null, steps: [agent({ prompt: "x" }), agent({ prompt: "use {{prev}}" })] }],
    });
    expect(pipe).toContain("${prev}");

    // Assert on the executable body only — the trailing mirror keeps the original prompt verbatim
    // (that is what makes round-trip exact), so {{prev}} legitimately survives there.
    const single = compile({
      name: "w",
      description: "",
      phases: [{ title: "P", mode: "single", repeatBudget: null, steps: [agent({ prompt: "use {{prev}}" })] }],
    });
    const body = single.split("/* @composer-workflow")[0];
    expect(body).not.toContain("${prev}");
    expect(body).not.toContain("{{prev}}");
  });
});

describe("parse (mirror round-trip)", () => {
  it("recovers a blank tree exactly", () => {
    const t = blankTree("hello");
    expect(parse(compile(t))).toEqual(t);
  });

  it("recovers a rich tree exactly (fixed point)", () => {
    const t = richTree();
    expect(parse(compile(t))).toEqual(t);
  });

  it("compile is idempotent through a parse round-trip", () => {
    const t = richTree();
    const once = compile(t);
    const twice = compile(parse(once)!);
    expect(twice).toBe(once);
  });

  it("returns null for source without a mirror", () => {
    expect(parse("export const meta = { name: 'x', phases: [] }\nphase('P')\n")).toBeNull();
  });

  it("returns null for empty / non-string input", () => {
    expect(parse("")).toBeNull();
    // @ts-expect-error runtime guard for non-string
    expect(parse(null)).toBeNull();
  });

  it("survives a prompt containing the comment-close marker */", () => {
    const t: Tree = {
      name: "w",
      description: "",
      phases: [blankPhase("P")],
    };
    t.phases[0].steps = [agent({ prompt: "beware */ end" })];
    expect(parse(compile(t))).toEqual(t);
  });

  it("back-fills fields a pre-upgrade mirror lacks (agent tools, group title)", () => {
    // A mirror written before `tools`/`title` existed: agents carry no `tools`, the container no `title`.
    // The parsed tree must still be well-formed so the outline UI can read them without crashing.
    const legacy =
      "export const meta = {}\n/* @composer-workflow\n" +
      JSON.stringify({
        name: "old",
        description: "",
        phases: [
          {
            title: "P",
            mode: "parallel",
            repeatBudget: null,
            steps: [
              { type: "agent", label: "a", prompt: "", model: "", provider: "", effort: "", agentType: "", schema: "" },
              {
                type: "container",
                mode: "pipeline",
                steps: [{ type: "agent", label: "b", prompt: "", model: "", provider: "", effort: "", agentType: "", schema: "" }],
              },
            ],
          },
        ],
      }) +
      "\n*/\n";
    const t = parse(legacy)!;
    const bareAgent = t.phases[0].steps[0] as Agent;
    const group = t.phases[0].steps[1] as Container;
    expect(bareAgent.tools).toEqual([]);
    expect(group.title).toBe("");
    expect((group.steps[0] as Agent).tools).toEqual([]);
  });
});

describe("blank nodes carry editor-only fields", () => {
  it("blankContainer() has an empty title", () => {
    expect(blankContainer().title).toBe("");
  });

  it("blankAgent() has an empty tools list", () => {
    expect(blankAgent().tools).toEqual([]);
  });
});

describe("tools/title round-trip through the mirror but never reach the compiled body", () => {
  function treeWithToolsAndTitle(): Tree {
    const container = blankContainer("parallel");
    container.title = "%Groupname%";
    return {
      name: "w",
      description: "",
      phases: [
        {
          title: "P",
          mode: "parallel",
          repeatBudget: null,
          steps: [agent({ tools: ["Read", "Bash"] }), container],
        },
      ],
    };
  }

  it("round-trips a container title and an agent's tools through parse(compile(tree))", () => {
    const t = treeWithToolsAndTitle();
    expect(parse(compile(t))).toEqual(t);
  });

  it("omits tools and the group title from the compiled body", () => {
    const t = treeWithToolsAndTitle();
    const body = compile(t).split("/* @composer-workflow")[0];
    expect(body).not.toContain("Read");
    expect(body).not.toContain("%Groupname%");
  });
});

describe("readMetaDescription (hand-written fallback)", () => {
  it("reads a double-quoted description from a compiled file", () => {
    const src = compile({ ...blankTree("a"), description: "hi there" });
    expect(readMetaDescription(src)).toBe("hi there");
  });

  it("reads a single-quoted value that starts on the next line", () => {
    const src = "export const meta = {\n  name: 'x',\n  description:\n    'Runs the thing',\n  phases: [],\n}\n";
    expect(readMetaDescription(src)).toBe("Runs the thing");
  });

  it("reads a backtick value and collapses newlines/whitespace to single spaces", () => {
    const src = "export const meta = {\n  description: `line one\n  line two`,\n}\n";
    expect(readMetaDescription(src)).toBe("line one line two");
  });

  it("unescapes an escaped newline in a double-quoted value", () => {
    const src = 'export const meta = {\n  description: "a\\nb",\n}\n';
    expect(readMetaDescription(src)).toBe("a b");
  });

  it("ignores a description: that appears before the meta block (e.g. in a comment)", () => {
    const src = "// description: 'not this one'\nexport const meta = {\n  description: 'the real one',\n}\n";
    expect(readMetaDescription(src)).toBe("the real one");
  });

  it("returns '' when there is no meta block or no description key", () => {
    expect(readMetaDescription("phase('P')\nawait agent('hi', {})\n")).toBe("");
    expect(readMetaDescription("export const meta = { name: 'x', phases: [] }\n")).toBe("");
    expect(readMetaDescription("")).toBe("");
    expect(readMetaDescription(null as unknown as string)).toBe("");
  });
});
