import { describe, it, expect } from "vitest";
import {
  compile,
  parse,
  readMarker,
  readMetaDescription,
  blankTree,
  blankPhase,
  blankAgent,
  blankContainer,
  type Tree,
  type Agent,
  type Container,
} from "../src/workflow/workflow-model";

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
        iterateOver: "",
        iterateInWaves: false,
        maxParallel: null,
        repeat: null,
      },
      {
        title: "Verify",
        mode: "parallel",
        repeatBudget: 500000,
        steps: [
          agent({ prompt: "Verify A" }),
          blankContainer("pipeline"),
        ],
        iterateOver: "",
        iterateInWaves: false,
        maxParallel: null,
        repeat: null,
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
    expect(src).toContain("pipeline([{}],");
    // never seed a pipeline with null: the engine treats a null item as "dropped" and skips every stage,
    // so pipeline([null]) would silently run zero agents (task workflow-composer-pipeline-null-seed).
    expect(src).not.toContain("pipeline([null]");
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

  it("a legacy mirror carrying now-removed fields (agent tools, group title) drops them cleanly", () => {
    // Backward compat: an old file still has the machine mirror AND the since-removed fields. The parsed
    // tree must be well-formed on today's shape — those keys simply vanish (normalizeStep rebuilds nodes).
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
              { type: "agent", label: "a", prompt: "", model: "", provider: "", effort: "", agentType: "", schema: "", tools: ["Read"] },
              {
                type: "container",
                mode: "pipeline",
                title: "%Group%",
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
    expect("tools" in bareAgent).toBe(false);
    expect("title" in group).toBe(false);
  });
});

// Node settings (BP-134, decision workflow-node-settings-model): iterateOver, maxParallel and repeat
// are properties of the existing parallel/pipeline/agent nodes, not new node types.
describe("iterateOver — fan-out from a collection, no new node type", () => {
  function fanOutTree(over: { iterateOver?: string; maxParallel: number | null } = { maxParallel: null }): Tree {
    const group = blankContainer("parallel");
    group.iterateOver = over.iterateOver ?? "units";
    group.maxParallel = over.maxParallel;
    group.steps = [agent({ label: "impl", prompt: "Build {{item}} — plan says {{prev}}" })];
    return {
      name: "w",
      description: "",
      phases: [
        {
          ...blankPhase("Build"),
          mode: "pipeline",
          steps: [agent({ label: "plan", prompt: "Plan the work", schema: '{ "type": "object" }' }), group],
        },
      ],
    };
  }

  it("compiles to a .map over prev[iterateOver], each branch a thunk", () => {
    const body = compile(fanOutTree()).split("/* @composer-workflow")[0];
    expect(body).toContain('prev["units"]');
    expect(body).toContain(".map((item) => () =>");
    expect(body).toContain("parallel(");
  });

  it("empty iterateOver keeps the pre-BP-134 static-branches compilation untouched", () => {
    const group = blankContainer("parallel");
    group.steps = [agent({ prompt: "A" }), agent({ prompt: "B" })];
    const body = compile({ name: "w", description: "", phases: [{ ...blankPhase("P"), mode: "parallel", steps: [group] }] }).split(
      "/* @composer-workflow",
    )[0];
    expect(body).not.toContain(".map(");
    expect(body).toContain("parallel([");
  });

  it("round-trips iterateOver through the mirror", () => {
    const t = fanOutTree();
    expect(parse(compile(t))).toEqual(t);
  });
});

// iterateInWaves (workflow-constructor-dynamic-waves): a modifier on iterateOver — the incoming field
// is an array OF ARRAYS (waves), not a flat array of items. Waves run in order, one at a time; branches
// inside a wave still run in parallel (and still respect maxParallel). The wave count comes from
// `prev[iterateOver].length` at runtime — never authored as a fixed number of rounds, unlike `repeat`.
describe("iterateInWaves — sequential rounds of parallel fan-out, from data (not repeat)", () => {
  function wavesTree(maxParallel: number | null = null): Tree {
    const group = blankContainer("parallel");
    group.iterateOver = "waves";
    group.iterateInWaves = true;
    group.maxParallel = maxParallel;
    group.steps = [agent({ label: "impl", prompt: "Build {{item}} — plan says {{prev}}" })];
    return {
      name: "w",
      description: "",
      phases: [
        {
          ...blankPhase("Build"),
          mode: "pipeline",
          steps: [agent({ label: "plan", prompt: "Plan the work", schema: '{ "type": "object" }' }), group],
        },
      ],
    };
  }

  it("compiles to a sequential loop over prev[iterateOver], parallel() per wave, results flattened", () => {
    const body = compile(wavesTree()).split("/* @composer-workflow")[0];
    expect(body).toContain('prev["waves"]');
    expect(body).toContain("for (const wave of waves)");
    expect(body).toContain(".map((item) => () =>");
    expect(body).toContain("parallel(");
    expect(body).toContain("out.push(...(await");
  });

  it("still batches by maxParallel WITHIN a wave", () => {
    const body = compile(wavesTree(2)).split("/* @composer-workflow")[0];
    expect(body).toContain("for (let i = 0; i < items.length; i += 2)");
    expect(body).toContain("await parallel(items.slice(i, i + 2))");
  });

  it("actually executes: wave 2 starts only after wave 1 fully resolves, results flatten in wave order", async () => {
    // String assertions above check SHAPE; this runs the compiled body for real against a fake
    // pipeline/parallel/agent, the only way to catch a runtime defect like a shadowed `items` binding
    // (parallelWithLimit's own `const items = …` colliding with a same-named variable spliced into its
    // thunks expression — TDZ ReferenceError at execution, invisible to `toContain` checks). A
    // non-null maxParallel is what actually exercises that wrapped-`const items` branch.
    const body = compile(wavesTree(2)).split("/* @composer-workflow")[0];
    // Strip the leading `export const meta = {…}` block — `export` is a syntax error inside
    // `new Function`'s body. The block always ends at the first "}\n\n" (see metaBlock()/compile()).
    const statements = body.slice(body.indexOf("}\n\n") + "}\n\n".length);
    const calls: string[] = [];
    async function pipeline(items: unknown[], ...stages: Array<(prev: unknown) => unknown>) {
      return Promise.all(
        items.map(async (item) => {
          let prev: unknown = item;
          for (const stage of stages) prev = await stage(prev);
          return prev;
        }),
      );
    }
    async function parallel(thunks: Array<() => Promise<unknown>>) {
      return Promise.all(thunks.map((t) => t()));
    }
    async function agent(prompt: string, opts: { label?: string }) {
      if (opts.label === "plan") return { waves: [["a", "b"], ["c"]] };
      const item = /Build (\S+)/.exec(prompt)![1];
      calls.push(item);
      return item;
    }
    const run = new Function("phase", "pipeline", "parallel", "agent", "budget", `return (async () => {\n${statements}\n})()`);
    await run(
      () => {},
      pipeline,
      parallel,
      agent,
      { total: null, remaining: () => Infinity },
    );
    expect(calls.indexOf("c")).toBeGreaterThan(calls.indexOf("a"));
    expect(calls.indexOf("c")).toBeGreaterThan(calls.indexOf("b"));
  });

  it("false/absent iterateInWaves keeps the flat iterateOver compilation untouched", () => {
    const group = blankContainer("parallel");
    group.iterateOver = "units";
    group.steps = [agent({ prompt: "Build {{item}}" })];
    const body = compile({ name: "w", description: "", phases: [{ ...blankPhase("P"), mode: "parallel", steps: [group] }] }).split(
      "/* @composer-workflow",
    )[0];
    expect(body).not.toContain("for (const wave of waves)");
    expect(body).toContain(".map((item) => () =>");
  });

  it("round-trips iterateInWaves through the mirror", () => {
    const t = wavesTree(3);
    expect(parse(compile(t))).toEqual(t);
  });

  it("back-fills iterateInWaves as false on a pre-existing mirror lacking the field", () => {
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
            steps: [{ type: "agent", label: "a", prompt: "", model: "", provider: "", effort: "", agentType: "", schema: "" }],
            iterateOver: "units",
          },
        ],
      }) +
      "\n*/\n";
    const t = parse(legacy)!;
    expect(t.phases[0].iterateInWaves).toBe(false);
  });
});

describe("maxParallel — a manual concurrency cap, not an engine option", () => {
  it("neither engine's parallel() takes an options argument, so a cap batches thunks in a for-loop", () => {
    const group = blankContainer("parallel");
    group.maxParallel = 2;
    group.steps = [agent({ prompt: "A" }), agent({ prompt: "B" }), agent({ prompt: "C" })];
    const body = compile({ name: "w", description: "", phases: [{ ...blankPhase("P"), mode: "parallel", steps: [group] }] }).split(
      "/* @composer-workflow",
    )[0];
    expect(body).toContain("for (let i = 0; i < items.length; i += 2)");
    expect(body).toContain("await parallel(items.slice(i, i + 2))");
    // never a bare second argument to parallel() — the engine would silently ignore it, not reject it
    expect(body).not.toMatch(/parallel\(\[[^\]]*\],\s*\{/);
  });

  it("null maxParallel compiles to the same single parallel([...]) as before BP-134", () => {
    const group = blankContainer("parallel");
    group.maxParallel = null;
    group.steps = [agent({ prompt: "A" }), agent({ prompt: "B" })];
    const withNoCap = compile({ name: "w", description: "", phases: [{ ...blankPhase("P"), mode: "parallel", steps: [group] }] }).split(
      "/* @composer-workflow",
    )[0];
    expect(withNoCap).not.toContain("for (let i");
    expect(withNoCap).toContain("parallel([");
  });

  it("round-trips maxParallel through the mirror", () => {
    const group = blankContainer("parallel");
    group.maxParallel = 3;
    group.steps = [agent()];
    const t: Tree = { name: "w", description: "", phases: [{ ...blankPhase("P"), mode: "parallel", steps: [group] }] };
    expect(parse(compile(t))).toEqual(t);
  });
});

describe("repeat — until/maxLoops as a property of any node, generalizing repeatBudget", () => {
  it("wraps an agent in a bounded loop that breaks when `until` is truthy on `result`", () => {
    const a = agent({ prompt: "review it" });
    a.repeat = { maxLoops: 2, until: "result.satisfied" };
    const body = compile({ name: "w", description: "", phases: [{ ...blankPhase("P"), mode: "single", steps: [a] }] }).split(
      "/* @composer-workflow",
    )[0];
    expect(body).toContain("for (let round = 0; round < 2; round++)");
    expect(body).toContain("if (result && (result.satisfied)) break;");
  });

  it("empty until runs exactly maxLoops times with no early exit", () => {
    const a = agent({ prompt: "go" });
    a.repeat = { maxLoops: 3, until: "" };
    const body = compile({ name: "w", description: "", phases: [{ ...blankPhase("P"), mode: "single", steps: [a] }] }).split(
      "/* @composer-workflow",
    )[0];
    expect(body).toContain("round < 3");
    expect(body).not.toContain("if (result");
  });

  it("also wraps a container (a whole group can be repeated, not just a single agent)", () => {
    const group = blankContainer("pipeline");
    group.repeat = { maxLoops: 2, until: "result[0] && result[0].satisfied" };
    group.steps = [agent({ label: "review" }), agent({ label: "fix" })];
    const body = compile({ name: "w", description: "", phases: [{ ...blankPhase("P"), mode: "single", steps: [group] }] }).split(
      "/* @composer-workflow",
    )[0];
    expect(body).toContain("pipeline([{}],");
    expect(body).toContain("if (result && (result[0] && result[0].satisfied)) break;");
  });

  it("is independent from repeatBudget — a phase can carry both axes at once", () => {
    const a = agent({ prompt: "go" });
    a.repeat = { maxLoops: 2, until: "result.done" };
    const body = compile({ name: "w", description: "", phases: [{ ...blankPhase("P"), mode: "single", repeatBudget: 100000, steps: [a] }] }).split(
      "/* @composer-workflow",
    )[0];
    expect(body).toContain("while (budget.total && budget.remaining() > 100000)");
    expect(body).toContain("round < 2");
  });

  it("round-trips repeat on an agent and on a container through the mirror", () => {
    const a = agent({ prompt: "go" });
    a.repeat = { maxLoops: 2, until: "result.ok" };
    const group = blankContainer("parallel");
    group.repeat = { maxLoops: 1, until: "" };
    group.steps = [agent()];
    const t: Tree = { name: "w", description: "", phases: [{ ...blankPhase("P"), mode: "parallel", steps: [a, group] }] };
    expect(parse(compile(t))).toEqual(t);
  });

  it("back-fills repeat as null on a pre-BP-134 mirror lacking the field", () => {
    const legacy =
      "export const meta = {}\n/* @composer-workflow\n" +
      JSON.stringify({
        name: "old",
        description: "",
        phases: [
          {
            title: "P",
            mode: "single",
            repeatBudget: null,
            steps: [{ type: "agent", label: "a", prompt: "", model: "", provider: "", effort: "", agentType: "", schema: "" }],
          },
        ],
      }) +
      "\n*/\n";
    const t = parse(legacy)!;
    expect(t.phases[0].iterateOver).toBe("");
    expect(t.phases[0].maxParallel).toBeNull();
    expect(t.phases[0].repeat).toBeNull();
    expect((t.phases[0].steps[0] as Agent).repeat).toBeNull();
  });
});

describe("marker + side-trace (parse-over-mirror)", () => {
  function knobbedTree(engine: "bb" | "claude"): Tree {
    const a = agent({
      label: "x",
      agentType: "code-reviewer",
      model: "opus",
      effort: "high",
      provider: engine === "bb" ? "claude-code" : "",
      schema: '{ "type": "object" }',
    });
    return { name: "w", description: "", phases: [{ ...blankPhase("P"), mode: "single", steps: [a] }] };
  }

  it("carries the agent knobs the body can't round-trip in the marker side-trace", () => {
    const m = readMarker(compile(knobbedTree("bb"), "bb"));
    expect(m?.agents[0]).toEqual({ agentType: "code-reviewer", model: "opus", effort: "high", provider: "claude-code" });
  });

  it("readMarker returns null with no marker and with a foreign format version", () => {
    expect(readMarker("phase('P')\nawait agent('hi', {})\n")).toBeNull();
    expect(readMarker('// @cc-wf v999 {"agents":[]}')).toBeNull();
  });

  it("recovers agentType under bb (dropped from the body) via the side-trace", () => {
    const t = knobbedTree("bb");
    expect(parse(compile(t, "bb"), "bb")).toEqual(t);
  });

  it("recovers a claude workflow (agentType/model/effort in body, provider empty)", () => {
    const t = knobbedTree("claude");
    expect(parse(compile(t, "claude"), "claude")).toEqual(t);
  });

  it("no marker (hand-written) → null → read-only", () => {
    expect(parse("export const meta = { name: \"x\", description: \"\", phases: [] }\n\n  phase(\"P\")\n  await agent(`hi`, {})\n")).toBeNull();
  });

  it("a hand-edited body no longer recompiles → null → read-only (no silent overwrite)", () => {
    const t: Tree = { name: "w", description: "", phases: [{ ...blankPhase("P"), mode: "parallel", steps: [agent({ prompt: "A" }), agent({ prompt: "B" })] }] };
    const src = compile(t);
    expect(parse(src)).not.toBeNull(); // sanity: the clean file parses
    // Tolerated by the parser (extra spaces trimmed) but not reproduced by recompile → mismatch → null.
    expect(parse(src.replace("() => agent", "() =>  agent"))).toBeNull();
  });

  it("a new-marker file whose prompt contains the legacy mirror opener still parses (not routed to legacy)", () => {
    const t: Tree = { name: "w", description: "", phases: [{ ...blankPhase("P"), mode: "single", steps: [agent({ prompt: "see /* @composer-workflow for details" })] }] };
    expect(parse(compile(t))).toEqual(t);
  });

  it("canonicalises a single-mode phase with many steps to parallel", () => {
    const t: Tree = { name: "w", description: "", phases: [{ ...blankPhase("P"), mode: "single", steps: [agent({ prompt: "A" }), agent({ prompt: "B" })] }] };
    expect(parse(compile(t))!.phases[0].mode).toBe("parallel");
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

// Runs a compiled body for real against fake engine primitives. `agentImpl` answers every agent()
// call; every call is recorded as { label, prompt } in order of invocation.
async function runCompiled(
  source: string,
  args: unknown,
  agentImpl: (prompt: string, opts: { label?: string }) => unknown,
): Promise<Array<{ label: string; prompt: string }>> {
  const body = source.split("\n// Made with Claude Config")[0];
  const statements = body.slice(body.indexOf("}\n\n") + "}\n\n".length);
  const calls: Array<{ label: string; prompt: string }> = [];
  async function pipeline(items: unknown[], ...stages: Array<(prev: unknown) => unknown>) {
    return Promise.all(
      items.map(async (item) => {
        let prev: unknown = item;
        for (const stage of stages) prev = await stage(prev);
        return prev;
      }),
    );
  }
  async function parallel(thunks: Array<() => Promise<unknown>>) {
    return Promise.all(thunks.map((t) => t()));
  }
  async function agentFake(prompt: string, opts: { label?: string }) {
    calls.push({ label: opts.label ?? "", prompt });
    return agentImpl(prompt, opts);
  }
  const run = new Function("phase", "pipeline", "parallel", "agent", "budget", "args", `return (async () => {\n${statements}\n})()`);
  await run(() => {}, pipeline, parallel, agentFake, { total: null, remaining: () => Infinity }, args);
  return calls;
}

describe("{{item}} reaches every agent nested inside a per-item template", () => {
  // plan → waves group whose per-item template is a pipeline implement → review.
  function chainTree(): Tree {
    const chain = blankContainer("pipeline");
    chain.steps = [
      agent({ label: "implement", prompt: "Build {{item}}" }),
      agent({ label: "review", prompt: "Review {{item}} after {{prev}}" }),
    ];
    const group = blankContainer("parallel");
    group.iterateOver = "waves";
    group.iterateInWaves = true;
    group.steps = [chain];
    return {
      name: "chain",
      description: "",
      phases: [{ ...blankPhase("Build"), mode: "pipeline", steps: [agent({ label: "plan", prompt: "Plan" }), group] }],
    };
  }

  it("each stage of a pipeline template gets its own element, and review sees implement's result", async () => {
    const calls = await runCompiled(compile(chainTree(), "claude"), undefined, (prompt, opts) =>
      opts.label === "plan" ? { waves: [["a", "b"], ["c"]] } : opts.label === "implement" ? "built-" + prompt.slice(6) : "ok",
    );
    const reviews = calls.filter((c) => c.label === "review").map((c) => c.prompt).sort();
    expect(reviews).toEqual(["Review a after built-a", "Review b after built-b", "Review c after built-c"]);
    const implements_ = calls.filter((c) => c.label === "implement").map((c) => c.prompt).sort();
    expect(implements_).toEqual(["Build a", "Build b", "Build c"]);
  });

  it("wave 2's chain starts only after every chain of wave 1 has finished its last stage", async () => {
    const calls = await runCompiled(compile(chainTree(), "claude"), undefined, (prompt, opts) =>
      opts.label === "plan" ? { waves: [["a", "b"], ["c"]] } : "x",
    );
    const at = (p: string) => calls.findIndex((c) => c.prompt.startsWith(p));
    expect(at("Build c")).toBeGreaterThan(at("Review a"));
    expect(at("Build c")).toBeGreaterThan(at("Review b"));
  });

  it("outside any iterated group {{item}} still has no meaning and is dropped", () => {
    const chain = blankContainer("pipeline");
    chain.steps = [agent({ prompt: "Build {{item}}" })];
    const tree: Tree = { name: "n", description: "", phases: [{ ...blankPhase("N"), mode: "pipeline", steps: [agent({ prompt: "Plan" }), chain] }] };
    expect(compile(tree, "claude")).not.toContain("${item}");
  });

  it("a file with a nested per-item chain opens for editing: parse recovers the same tree", () => {
    const tree = chainTree();
    expect(parse(compile(tree, "claude"), "claude")).toEqual(tree);
  });
});

describe("{{args}} — the run input, usable in any prompt", () => {
  const ARGS_EXPR = '${typeof args === "string" ? args : JSON.stringify(args)}';

  function argsTree(): Tree {
    const chain = blankContainer("pipeline");
    chain.steps = [agent({ label: "implement", prompt: "Do {{item}} of {{args}}" })];
    const group = blankContainer("parallel");
    group.iterateOver = "waves";
    group.iterateInWaves = true;
    group.steps = [chain];
    return {
      name: "args",
      description: "",
      phases: [
        { ...blankPhase("Read"), steps: [agent({ label: "solo", prompt: "Input is {{args}}" })] },
        {
          ...blankPhase("Build"),
          mode: "pipeline",
          steps: [agent({ label: "plan", prompt: "Read plan {{args}} after {{prev}}" }), group],
        },
      ],
    };
  }

  it("an object input reaches the prompt as JSON", async () => {
    const calls = await runCompiled(compile(argsTree(), "claude"), { plan: "p.md" }, (_p, opts) =>
      opts.label === "plan" ? { waves: [] } : "ok",
    );
    expect(calls[0].prompt).toBe('Input is {"plan":"p.md"}');
  });

  it("works the same under the bb engine", () => {
    expect(compile(argsTree(), "bb")).toContain("`Input is " + ARGS_EXPR + "`");
  });

  it("a literal ${args} typed into a prompt stays text, not an input", async () => {
    const tree: Tree = { name: "lit", description: "", phases: [{ ...blankPhase("L"), steps: [agent({ prompt: "Write ${args} literally" })] }] };
    const src = compile(tree, "claude");
    expect(parse(src, "claude")).toEqual(tree);
    const calls = await runCompiled(src, "IGNORED", () => "ok");
    expect(calls[0].prompt).toBe("Write ${args} literally");
  });

  it("a file using {{args}}, {{prev}} and {{item}} together opens for editing: parse recovers the same tree", () => {
    const tree = argsTree();
    expect(parse(compile(tree, "claude"), "claude")).toEqual(tree);
    expect(parse(compile(tree, "bb"), "bb")).toEqual(tree);
  });
});

describe("{{prev}} and {{item}} reach the prompt as text", () => {
  function stagesTree(first: Agent, second: Agent): Tree {
    return { name: "s", description: "", phases: [{ ...blankPhase("P"), mode: "pipeline", steps: [first, second] }] };
  }

  it("a structured result of the previous stage reaches the next prompt as JSON", async () => {
    const tree = stagesTree(agent({ label: "judge", prompt: "Judge" }), agent({ label: "fix", prompt: "Fix by {{prev}}" }));
    const calls = await runCompiled(compile(tree, "claude"), undefined, (_p, opts) =>
      opts.label === "judge" ? { verdict: "NOT_SATISFIED", findings: ["a.ts:1 — x"] } : "ok",
    );
    expect(calls[1].prompt).toBe('Fix by {"verdict":"NOT_SATISFIED","findings":["a.ts:1 — x"]}');
  });

  it("a text result of the previous stage reaches the next prompt verbatim", async () => {
    const tree = stagesTree(agent({ label: "scout", prompt: "Scout" }), agent({ label: "plan", prompt: "Plan from {{prev}}" }));
    const calls = await runCompiled(compile(tree, "bb"), undefined, () => "src/a.ts:12");
    expect(calls[1].prompt).toBe("Plan from src/a.ts:12");
  });

  it("outside a pipeline stage {{prev}} has no meaning and leaves no trace in the prompt", async () => {
    const tree: Tree = { name: "o", description: "", phases: [{ ...blankPhase("P"), steps: [agent({ prompt: "use {{prev}}" })] }] };
    const calls = await runCompiled(compile(tree, "claude"), undefined, () => "ok");
    expect(calls[0].prompt).toBe("use ");
  });

  it("a group nested in a pipeline stage resolves {{prev}} for its agents", async () => {
    const group = blankContainer("parallel");
    group.steps = [agent({ label: "a", prompt: "A sees {{prev}}" }), agent({ label: "b", prompt: "B sees {{prev}}" })];
    const tree = stagesTree(agent({ label: "first", prompt: "First" }), group as unknown as Agent);
    const calls = await runCompiled(compile(tree, "claude"), undefined, (_p, opts) => (opts.label === "first" ? { n: 1 } : "ok"));
    expect(calls.slice(1).map((c) => c.prompt).sort()).toEqual(['A sees {"n":1}', 'B sees {"n":1}']);
  });

  it("an element that is an object reaches the per-item prompt as JSON, a string element verbatim", async () => {
    const group = blankContainer("parallel");
    group.iterateOver = "units";
    group.steps = [agent({ label: "impl", prompt: "Build {{item}}" })];
    const tree = stagesTree(agent({ label: "plan", prompt: "Plan" }), group as unknown as Agent);
    const calls = await runCompiled(compile(tree, "claude"), undefined, (_p, opts) =>
      opts.label === "plan" ? { units: ["u1", { slug: "u2" }] } : "ok",
    );
    expect(calls.slice(1).map((c) => c.prompt).sort()).toEqual(["Build u1", 'Build {"slug":"u2"}']);
  });

  it("a string input reaches every prompt verbatim, alongside {{prev}} and {{item}}", async () => {
    const chain = blankContainer("pipeline");
    chain.steps = [agent({ label: "implement", prompt: "Do {{item}} of {{args}}" })];
    const group = blankContainer("parallel");
    group.iterateOver = "waves";
    group.iterateInWaves = true;
    group.steps = [chain];
    const tree = stagesTree(agent({ label: "plan", prompt: "Read plan {{args}}" }), group as unknown as Agent);
    const calls = await runCompiled(compile(tree, "claude"), "docs/plans/x.md", (_p, opts) =>
      opts.label === "plan" ? { waves: [["a"]] } : "ok",
    );
    expect(calls.map((c) => c.prompt)).toEqual(["Read plan docs/plans/x.md", "Do a of docs/plans/x.md"]);
  });

  it("a literal ${prev} or ${item} typed into a prompt stays text through save and run", async () => {
    const tree = stagesTree(agent({ prompt: "Plan" }), agent({ label: "lit", prompt: "Keep ${prev} and ${item} as text" }));
    const src = compile(tree, "claude");
    expect(parse(src, "claude")).toEqual(tree);
    const calls = await runCompiled(src, undefined, () => "ok");
    expect(calls[1].prompt).toBe("Keep ${prev} and ${item} as text");
  });
});

describe("placeholders at any depth of a per-item template", () => {
  it("a parallel group nested inside the template hands the element to both branches", async () => {
    const inner = blankContainer("parallel");
    inner.steps = [agent({ label: "left", prompt: "Left {{item}}" }), agent({ label: "right", prompt: "Right {{item}}" })];
    const group = blankContainer("parallel");
    group.iterateOver = "units";
    group.steps = [inner];
    const tree: Tree = { name: "p", description: "", phases: [{ ...blankPhase("P"), mode: "pipeline", steps: [agent({ label: "plan", prompt: "Plan" }), group] }] };
    const calls = await runCompiled(compile(tree, "claude"), undefined, (_p, opts) => (opts.label === "plan" ? { units: ["u1", "u2"] } : "ok"));
    expect(calls.slice(1).map((c) => c.prompt).sort()).toEqual(["Left u1", "Left u2", "Right u1", "Right u2"]);
  });

  it("{{args}} reaches a phase agent, a pipeline stage and a wave template alike", async () => {
    const chain = blankContainer("pipeline");
    chain.steps = [agent({ label: "implement", prompt: "Do {{item}} of {{args}}" })];
    const group = blankContainer("parallel");
    group.iterateOver = "waves";
    group.iterateInWaves = true;
    group.steps = [chain];
    const tree: Tree = {
      name: "a",
      description: "",
      phases: [
        { ...blankPhase("Read"), steps: [agent({ label: "solo", prompt: "Input {{args}}" })] },
        { ...blankPhase("Build"), mode: "pipeline", steps: [agent({ label: "plan", prompt: "Plan {{args}}" }), group] },
      ],
    };
    const calls = await runCompiled(compile(tree, "bb"), "p.md", (_p, opts) => (opts.label === "plan" ? { waves: [["a"]] } : "ok"));
    expect(calls.map((c) => c.prompt)).toEqual(["Input p.md", "Plan p.md", "Do a of p.md"]);
  });
});
