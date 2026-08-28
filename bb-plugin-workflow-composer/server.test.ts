import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import {
  createPlugin,
  extractRunId,
  parseAgentFrontmatter,
  pluginAgentName,
  seedGlobalWorkflows,
  type BbCliResult,
  type WorkflowDeps,
} from "./server";
import { compile, blankTree } from "./workflow-model";

// A recording fake for the bb CLI seam.
function fakeCli(reply: (args: string[]) => BbCliResult) {
  const calls: { args: string[]; cwd?: string }[] = [];
  const dep: Pick<WorkflowDeps, "runBbCli"> = {
    async runBbCli(args, opts) {
      calls.push({ args, cwd: opts?.cwd });
      return reply(args);
    },
  };
  return { calls, runBbCli: dep.runBbCli };
}

// Build a host with the plugin registered and project.get stubbed to a single-source project.
function setup(opts?: { cli?: (args: string[]) => BbCliResult; homeDir?: string; worktrees?: string[] }) {
  const { bb, harness } = createFakePluginHost({ pluginId: "workflow-composer" });
  harness.sdk.stub("projects.get", () => ({
    id: "p1",
    kind: "standard",
    name: "Repo",
    sources: [{ id: "s1", hostId: "h1", isDefault: true, path: "/repo", projectId: "p1", type: "local_path", createdAt: 0, updatedAt: 0 }],
    gitRemoteUrl: null,
    createdAt: 0,
    updatedAt: 0,
  }));
  const cli = fakeCli(opts?.cli ?? (() => ({ code: 0, stdout: "", stderr: "" })));
  createPlugin(bb, {
    runBbCli: cli.runBbCli,
    homeDir: opts?.homeDir ?? "/home/test",
    gitWorktrees: async () => opts?.worktrees ?? [],
  });
  return { bb, harness, cli, call: (m: string, i?: unknown) => harness.behavior.callRpc(m, i) };
}

describe("save", () => {
  it("writes the .js into the project store at the derived path", async () => {
    const { harness, call } = setup();
    let written: any = null;
    harness.sdk.stub("files.write", (args: any) => {
      written = args;
      return { outcome: "written", sha256: "x", sizeBytes: 3 };
    });
    const res = (await call("save", { projectId: "p1", store: "project", name: "my-flow", source: "SRC" })) as { path: string };
    expect(res.path).toBe("/repo/.bb/workflows/my-flow.js");
    expect(written.path).toBe("/repo/.bb/workflows/my-flow.js");
    expect(written.content).toBe("SRC");
    expect(written.hostId).toBe("h1");
    expect(written.createParents).toBe(true);
  });

  it("writes the global store under ~/.claude/workflows with no hostId", async () => {
    const { harness, call } = setup({ homeDir: "/home/test" });
    let written: any = null;
    harness.sdk.stub("files.write", (args: any) => {
      written = args;
      return { outcome: "written", sha256: "x", sizeBytes: 3 };
    });
    const res = (await call("save", { projectId: null, store: "global", name: "g", source: "S" })) as { path: string };
    expect(res.path).toBe("/home/test/.claude/workflows/g.js");
    expect(written.hostId).toBeUndefined();
  });

  it("rejects a non-kebab name", async () => {
    const { call } = setup();
    await expect(call("save", { projectId: "p1", store: "project", name: "Bad Name", source: "S" })).rejects.toBeTruthy();
  });
});

describe("list", () => {
  it("returns only top-level .js of the project store, parses the tree for description", async () => {
    const { harness, call } = setup();
    const src = compile({ ...blankTree("a"), description: "hi there" });
    harness.sdk.stub("files.listPaths", (args: any) => {
      if (args.path === "/repo/.bb/workflows") {
        return { paths: [{ path: "a.js" }, { path: "nested/b.js" }, { path: "c.txt" }], truncated: false };
      }
      throw new Error("no such dir"); // global dir missing → skipped
    });
    harness.sdk.stub("files.read", () => ({ content: src, sha256: "x", contentEncoding: "utf8", sizeBytes: src.length }));
    const res = (await call("list", { projectId: "p1" })) as { items: any[] };
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({ name: "a", store: "project", hasTree: true, description: "hi there", path: "/repo/.bb/workflows/a.js" });
  });

  it("unions project workflows across the main checkout and its git worktrees, deduped by name", async () => {
    const { harness, call } = setup({ worktrees: ["/repo", "/wt"] });
    const src = compile({ ...blankTree("x"), description: "" });
    harness.sdk.stub("files.listPaths", (args: any) => {
      if (args.path === "/repo/.bb/workflows") return { paths: [{ path: "shared.js" }, { path: "main-only.js" }], truncated: false };
      if (args.path === "/wt/.bb/workflows") return { paths: [{ path: "shared.js" }, { path: "wt-only.js" }], truncated: false };
      throw new Error("no dir");
    });
    harness.sdk.stub("files.read", () => ({ content: src, sha256: "x", contentEncoding: "utf8", sizeBytes: src.length }));
    const res = (await call("list", { projectId: "p1" })) as { items: { name: string; path: string }[] };
    const names = res.items.map((i) => i.name).sort();
    expect(names).toEqual(["main-only", "shared", "wt-only"]);
    // dedup keeps the main checkout's copy of a shared name
    expect(res.items.find((i) => i.name === "shared")!.path).toBe("/repo/.bb/workflows/shared.js");
  });

  it("falls back to the meta description for a hand-written workflow with no mirror", async () => {
    const { harness, call } = setup();
    const handWritten = "export const meta = {\n  name: 'hand',\n  description: 'does a hand-written thing',\n  phases: [],\n}\nphase('P')\nawait agent('hi', {})\n";
    harness.sdk.stub("files.listPaths", (args: any) => {
      if (args.path === "/repo/.bb/workflows") return { paths: [{ path: "hand.js" }], truncated: false };
      throw new Error("no such dir");
    });
    harness.sdk.stub("files.read", () => ({ content: handWritten, sha256: "x", contentEncoding: "utf8", sizeBytes: handWritten.length }));
    const res = (await call("list", { projectId: "p1" })) as { items: any[] };
    expect(res.items[0]).toMatchObject({ name: "hand", hasTree: false, description: "does a hand-written thing" });
  });
});

describe("read / remove", () => {
  it("read returns source and parsed tree", async () => {
    const { harness, call } = setup();
    const src = compile(blankTree("z"));
    harness.sdk.stub("files.read", () => ({ content: src, sha256: "x", contentEncoding: "utf8", sizeBytes: src.length }));
    const res = (await call("read", { projectId: "p1", store: "project", path: "/repo/.bb/workflows/z.js" })) as { source: string; tree: any };
    expect(res.source).toBe(src);
    expect(res.tree.name).toBe("z");
  });

  it("remove deletes at the path and enforces the store guard", async () => {
    const { harness, call } = setup();
    let removed: any = null;
    harness.sdk.stub("files.remove", (args: any) => {
      removed = args;
      return { outcome: "removed" };
    });
    await call("remove", { projectId: "p1", store: "project", path: "/repo/.bb/workflows/z.js" });
    expect(removed.path).toBe("/repo/.bb/workflows/z.js");
    // path outside the store is rejected
    await expect(call("remove", { projectId: "p1", store: "project", path: "/repo/evil.js" })).rejects.toBeTruthy();
  });
});

describe("validate / run / status via the CLI seam", () => {
  it("validate calls `bb workflows validate --file` in the project cwd", async () => {
    const { cli, call } = setup({ cli: () => ({ code: 0, stdout: "all good", stderr: "" }) });
    const res = (await call("validate", { projectId: "p1", store: "project", path: "/repo/.bb/workflows/z.js" })) as { ok: boolean; output: string };
    expect(res).toEqual({ ok: true, output: "all good" });
    expect(cli.calls[0]).toEqual({ args: ["workflows", "validate", "--file", "/repo/.bb/workflows/z.js"], cwd: "/repo" });
  });

  it("validate reports failure on a non-zero exit", async () => {
    const { call } = setup({ cli: () => ({ code: 1, stdout: "", stderr: "boom" }) });
    const res = (await call("validate", { projectId: "p1", store: "project", path: "/repo/.bb/workflows/z.js" })) as { ok: boolean };
    expect(res.ok).toBe(false);
  });

  it("run extracts the run id from JSON output", async () => {
    const { call } = setup({ cli: () => ({ code: 0, stdout: '{"runId":"wfr_abc-123","name":"z","status":"queued"}', stderr: "" }) });
    const res = (await call("run", { projectId: "p1", store: "project", path: "/repo/.bb/workflows/z.js" })) as { runId: string | null };
    expect(res.runId).toBe("wfr_abc-123");
  });

  it("status shells out with the run id", async () => {
    const { cli, call } = setup({ cli: () => ({ code: 0, stdout: "phase 1/2", stderr: "" }) });
    const res = (await call("status", { runId: "wf_abc123" })) as { output: string };
    expect(res.output).toBe("phase 1/2");
    expect(cli.calls[0].args).toEqual(["workflows", "status", "wf_abc123"]);
  });
});

describe("extractRunId", () => {
  it("prefers JSON runId, falls back to a token, else null", () => {
    expect(extractRunId('{"runId":"wfr_dead-beef"}')).toBe("wfr_dead-beef");
    expect(extractRunId("run wfr_deadbeef started")).toBe("wfr_deadbeef");
    expect(extractRunId("nothing here")).toBeNull();
  });
});

describe("models", () => {
  it("returns provider model ids, sorted and de-duped", async () => {
    const { harness, call } = setup();
    harness.sdk.stub("providers.models", () => ({ models: [{ id: "opus" }, { id: "sonnet" }, { id: "opus" }], modelLoadError: null }));
    const res = (await call("models", null)) as { models: string[] };
    expect(res.models).toEqual(["opus", "sonnet"]);
  });

  it("falls back to a static list when the catalog is unavailable", async () => {
    const { harness, call } = setup();
    harness.sdk.stub("providers.models", () => {
      throw new Error("no catalog");
    });
    const res = (await call("models", null)) as { models: string[] };
    expect(res.models).toContain("opus");
  });
});

describe("agents", () => {
  it("unions user, project, and plugin agents into a deduped sorted list, with model/effort read from frontmatter", async () => {
    const { harness, call } = setup({ homeDir: "/home/test" });
    harness.sdk.stub("files.listPaths", (args: any) => {
      if (args.path === "/home/test/.claude/agents") {
        return { paths: [{ path: "code-reviewer.md" }, { path: "nested/ignored.md" }, { path: "notes.txt" }], truncated: false };
      }
      if (args.path === "/home/test/.claude/plugins") {
        return {
          paths: [
            { path: "cache/claude-plugins-official/feature-dev/5e821f406d57/agents/code-explorer.md" },
            { path: "cache/claude-plugins-official/code-simplifier/1.0.0/agents/code-simplifier.md" },
            { path: "marketplaces/claude-plugins-official/plugins/feature-dev/agents/code-explorer.md" },
            { path: "cache/claude-plugins-official/feature-dev/5e821f406d57/README.md" }, // not directly in agents/ → skipped
          ],
          truncated: false,
        };
      }
      if (args.path === "/repo/.claude/agents") {
        return { paths: [{ path: "reviewer.md" }], truncated: false };
      }
      throw new Error("no such dir");
    });
    const frontmatter: Record<string, string> = {
      "/home/test/.claude/agents/code-reviewer.md": "---\nname: code-reviewer\nmodel: opus\ndescription: Reviews code for quality issues\n---\nBody",
      "/home/test/.claude/plugins/cache/claude-plugins-official/feature-dev/5e821f406d57/agents/code-explorer.md": "---\nmodel: inherit\n---\n",
      "/home/test/.claude/plugins/cache/claude-plugins-official/code-simplifier/1.0.0/agents/code-simplifier.md": "---\nmodel: sonnet\neffort: high\n---\n",
      "/repo/.claude/agents/reviewer.md": "---\ndescription: no model set\n---\n",
    };
    harness.sdk.stub("files.read", (args: any) => {
      const content = frontmatter[args.path];
      if (content === undefined) throw new Error("unexpected read " + args.path);
      return { content, sha256: "x", contentEncoding: "utf8", sizeBytes: content.length };
    });
    const res = (await call("agents", { projectId: "p1" })) as {
      agents: { value: string; model: string; effort: string; provider: string; description: string; path: string }[];
    };
    expect(res.agents).toEqual([
      {
        value: "code-reviewer",
        model: "opus",
        effort: "",
        provider: "claude-code",
        description: "Reviews code for quality issues",
        path: "/home/test/.claude/agents/code-reviewer.md",
        tools: [],
        scope: "user",
      },
      {
        value: "code-simplifier:code-simplifier",
        model: "sonnet",
        effort: "high",
        provider: "claude-code",
        description: "",
        path: "/home/test/.claude/plugins/cache/claude-plugins-official/code-simplifier/1.0.0/agents/code-simplifier.md",
        tools: [],
        scope: "plugin",
      },
      {
        value: "feature-dev:code-explorer",
        model: "inherit",
        effort: "",
        provider: "claude-code",
        description: "",
        path: "/home/test/.claude/plugins/cache/claude-plugins-official/feature-dev/5e821f406d57/agents/code-explorer.md",
        tools: [],
        scope: "plugin",
      },
      {
        value: "reviewer",
        model: "",
        effort: "",
        provider: "claude-code",
        description: "no model set",
        path: "/repo/.claude/agents/reviewer.md",
        tools: [],
        scope: "project",
      },
    ]);
  });

  it("marks a user agent scope 'user' and a project agent scope 'project'", async () => {
    const { harness, call } = setup({ homeDir: "/home/test" });
    harness.sdk.stub("files.listPaths", (args: any) => {
      if (args.path === "/home/test/.claude/agents") return { paths: [{ path: "u.md" }], truncated: false };
      if (args.path === "/repo/.claude/agents") return { paths: [{ path: "p.md" }], truncated: false };
      throw new Error("no such dir");
    });
    harness.sdk.stub("files.read", () => ({ content: "---\nmodel: opus\n---\n", sha256: "x", contentEncoding: "utf8", sizeBytes: 0 }));
    const res = (await call("agents", { projectId: "p1" })) as { agents: { value: string; scope: string }[] };
    const byValue = Object.fromEntries(res.agents.map((a) => [a.value, a.scope]));
    expect(byValue["u"]).toBe("user");
    expect(byValue["p"]).toBe("project");
  });

  it("returns each agent's tools from frontmatter, supporting both comma-list and YAML-list syntax", async () => {
    const { harness, call } = setup({ homeDir: "/home/test" });
    harness.sdk.stub("files.listPaths", (args: any) => {
      if (args.path === "/home/test/.claude/agents") {
        return { paths: [{ path: "csv-tools.md" }, { path: "yaml-tools.md" }, { path: "no-tools.md" }], truncated: false };
      }
      throw new Error("no such dir");
    });
    const frontmatter: Record<string, string> = {
      "/home/test/.claude/agents/csv-tools.md": "---\nmodel: opus\ntools: Read, Grep, Glob\n---\nBody",
      "/home/test/.claude/agents/yaml-tools.md": "---\nmodel: opus\ntools:\n  - Read\n  - Grep\n---\nBody",
      "/home/test/.claude/agents/no-tools.md": "---\nmodel: opus\n---\nBody",
    };
    harness.sdk.stub("files.read", (args: any) => {
      const content = frontmatter[args.path];
      if (content === undefined) throw new Error("unexpected read " + args.path);
      return { content, sha256: "x", contentEncoding: "utf8", sizeBytes: content.length };
    });
    const res = (await call("agents", { projectId: null })) as { agents: { value: string; tools: string[] }[] };
    const byValue = Object.fromEntries(res.agents.map((a) => [a.value, a.tools]));
    expect(byValue["csv-tools"]).toEqual(["Read", "Grep", "Glob"]);
    expect(byValue["yaml-tools"]).toEqual(["Read", "Grep"]);
    expect(byValue["no-tools"]).toEqual([]);
  });

  it("skips project agents when projectId is null", async () => {
    const { harness, call } = setup({ homeDir: "/home/test" });
    harness.sdk.stub("files.listPaths", (args: any) => {
      if (args.path === "/home/test/.claude/agents") return { paths: [{ path: "code-reviewer.md" }], truncated: false };
      throw new Error("no such dir");
    });
    harness.sdk.stub("files.read", () => ({ content: "---\nmodel: opus\ndescription: reviews code\n---\n", sha256: "x", contentEncoding: "utf8", sizeBytes: 0 }));
    const res = (await call("agents", { projectId: null })) as {
      agents: { value: string; model: string; effort: string; provider: string; description: string; path: string }[];
    };
    expect(res.agents).toEqual([
      {
        value: "code-reviewer",
        model: "opus",
        effort: "",
        provider: "claude-code",
        description: "reviews code",
        path: "/home/test/.claude/agents/code-reviewer.md",
        tools: [],
        scope: "user",
      },
    ]);
  });

  it("still lists an agent when its frontmatter is unreadable, with blank model/effort", async () => {
    const { harness, call } = setup({ homeDir: "/home/test" });
    harness.sdk.stub("files.listPaths", (args: any) => {
      if (args.path === "/home/test/.claude/agents") return { paths: [{ path: "broken.md" }], truncated: false };
      throw new Error("no such dir");
    });
    harness.sdk.stub("files.read", () => {
      throw new Error("cannot read");
    });
    const res = (await call("agents", { projectId: null })) as {
      agents: { value: string; model: string; effort: string; provider: string; description: string; path: string }[];
    };
    expect(res.agents).toEqual([
      { value: "broken", model: "", effort: "", provider: "claude-code", description: "", path: "/home/test/.claude/agents/broken.md", tools: [], scope: "user" },
    ]);
  });
});

describe("parseAgentFrontmatter", () => {
  it("parses an inline comma-separated tools list", () => {
    expect(parseAgentFrontmatter("---\ntools: Read, Grep, Glob\n---\nBody").tools).toEqual(["Read", "Grep", "Glob"]);
  });

  it("parses a YAML list tools syntax", () => {
    expect(parseAgentFrontmatter("---\ntools:\n  - Read\n  - Grep\n---\nBody").tools).toEqual(["Read", "Grep"]);
  });

  it("returns an empty array when tools is absent", () => {
    expect(parseAgentFrontmatter("---\nmodel: opus\n---\nBody").tools).toEqual([]);
  });
});

describe("writeAgent", () => {
  it("scope user: writes to <homeDir>/.claude/agents/<name>.md with the given content, no hostId", async () => {
    const { harness, call } = setup({ homeDir: "/home/test" });
    let written: any = null;
    harness.sdk.stub("files.write", (args: any) => {
      written = args;
      return { outcome: "written", sha256: "x", sizeBytes: 3 };
    });
    const res = (await call("writeAgent", {
      projectId: null,
      scope: "user",
      name: "my-agent",
      content: "---\nmodel: opus\n---\nBody",
      overwrite: true,
    })) as { path: string };
    expect(res.path).toBe("/home/test/.claude/agents/my-agent.md");
    expect(written.path).toBe("/home/test/.claude/agents/my-agent.md");
    expect(written.content).toBe("---\nmodel: opus\n---\nBody");
    expect(written.createParents).toBe(true);
    expect(written.hostId).toBeUndefined();
  });

  it("scope project: writes to <projectPath>/.claude/agents/<name>.md with the project's hostId", async () => {
    const { harness, call } = setup();
    let written: any = null;
    harness.sdk.stub("files.write", (args: any) => {
      written = args;
      return { outcome: "written", sha256: "x", sizeBytes: 3 };
    });
    const res = (await call("writeAgent", {
      projectId: "p1",
      scope: "project",
      name: "my-agent",
      content: "body",
      overwrite: true,
    })) as { path: string };
    expect(res.path).toBe("/repo/.claude/agents/my-agent.md");
    expect(written.path).toBe("/repo/.claude/agents/my-agent.md");
    expect(written.hostId).toBe("h1");
  });

  it("rejects overwrite=false when the file already exists", async () => {
    const { harness, call } = setup({ homeDir: "/home/test" });
    harness.sdk.stub("files.read", () => ({ content: "existing", sha256: "x", contentEncoding: "utf8", sizeBytes: 8 }));
    await expect(
      call("writeAgent", { projectId: null, scope: "user", name: "existing-agent", content: "new", overwrite: false }),
    ).rejects.toBeTruthy();
  });

  it("allows overwrite=true on an existing file", async () => {
    const { harness, call } = setup({ homeDir: "/home/test" });
    harness.sdk.stub("files.read", () => ({ content: "existing", sha256: "x", contentEncoding: "utf8", sizeBytes: 8 }));
    let written: any = null;
    harness.sdk.stub("files.write", (args: any) => {
      written = args;
      return { outcome: "written", sha256: "x", sizeBytes: 3 };
    });
    const res = (await call("writeAgent", {
      projectId: null,
      scope: "user",
      name: "existing-agent",
      content: "new",
      overwrite: true,
    })) as { path: string };
    expect(res.path).toBe("/home/test/.claude/agents/existing-agent.md");
    expect(written.content).toBe("new");
  });

  it("allows overwrite=false when the file does not exist yet (Save as new)", async () => {
    const { harness, call } = setup({ homeDir: "/home/test" });
    harness.sdk.stub("files.read", () => {
      throw new Error("not found");
    });
    let written: any = null;
    harness.sdk.stub("files.write", (args: any) => {
      written = args;
      return { outcome: "written", sha256: "x", sizeBytes: 3 };
    });
    const res = (await call("writeAgent", {
      projectId: null,
      scope: "user",
      name: "brand-new",
      content: "new",
      overwrite: false,
    })) as { path: string };
    expect(res.path).toBe("/home/test/.claude/agents/brand-new.md");
    expect(written).not.toBeNull();
  });

  it("rejects a non-kebab-case name", async () => {
    const { call } = setup({ homeDir: "/home/test" });
    await expect(
      call("writeAgent", { projectId: null, scope: "user", name: "Bad Name", content: "x", overwrite: true }),
    ).rejects.toBeTruthy();
  });

  it("rejects a path-traversal name", async () => {
    const { call } = setup({ homeDir: "/home/test" });
    await expect(
      call("writeAgent", { projectId: null, scope: "user", name: "../evil", content: "x", overwrite: true }),
    ).rejects.toBeTruthy();
  });
});

describe("providerCatalog", () => {
  it("builds id/name/models per provider from providers.list + providers.models", async () => {
    const { harness, call } = setup();
    harness.sdk.stub("providers.list", () => [
      { id: "claude-code", displayName: "Claude Code" },
      { id: "codex", displayName: "Codex" },
    ]);
    harness.sdk.stub("providers.models", (args: any) => {
      if (args?.providerId === "claude-code") {
        return { models: [{ id: "opus", supportedReasoningEfforts: [{ reasoningEffort: "high" }, { reasoningEffort: "max" }] }] };
      }
      if (args?.providerId === "codex") {
        return { models: [{ id: "gpt-5.1", supportedReasoningEfforts: [{ reasoningEffort: "medium" }] }] };
      }
      throw new Error("unexpected provider " + args?.providerId);
    });
    const res = await call("providerCatalog", null);
    expect(res).toEqual([
      { id: "claude-code", name: "Claude Code", models: [{ id: "opus", efforts: ["high", "max"] }] },
      { id: "codex", name: "Codex", models: [{ id: "gpt-5.1", efforts: ["medium"] }] },
    ]);
  });

  it("yields an empty models list for a provider whose models() call fails, without failing the whole method", async () => {
    const { harness, call } = setup();
    harness.sdk.stub("providers.list", () => [{ id: "flaky", displayName: "Flaky" }]);
    harness.sdk.stub("providers.models", () => {
      throw new Error("provider down");
    });
    const res = await call("providerCatalog", null);
    expect(res).toEqual([{ id: "flaky", name: "Flaky", models: [] }]);
  });
});

describe("pluginAgentName", () => {
  it("steps past a hash-like version segment to find the plugin name", () => {
    expect(pluginAgentName("cache/claude-plugins-official/feature-dev/5e821f406d57/agents/code-explorer.md")).toBe("feature-dev:code-explorer");
  });

  it("steps past a version-like segment to find the plugin name", () => {
    expect(pluginAgentName("cache/claude-plugins-official/code-simplifier/1.0.0/agents/code-simplifier.md")).toBe("code-simplifier:code-simplifier");
  });

  it("uses the segment directly above agents/ when it isn't version/hash-like", () => {
    expect(pluginAgentName("marketplaces/claude-plugins-official/plugins/feature-dev/agents/code-explorer.md")).toBe("feature-dev:code-explorer");
  });

  it("rejects files not sitting directly in an agents/ directory", () => {
    expect(pluginAgentName("cache/claude-plugins-official/feature-dev/5e821f406d57/README.md")).toBeNull();
    expect(pluginAgentName("cache/claude-plugins-official/feature-dev/agents/nested/deep.md")).toBeNull();
  });
});

describe("agentRefs", () => {
  it("returns content plus a ref for an existing sibling .md", async () => {
    const { harness, call } = setup({ homeDir: "/home/test" });
    const content = "See [b](b.md) for details.";
    harness.sdk.stub("files.read", (args: any) => {
      if (args.path === "/home/test/.claude/agents/a.md") return { content, sha256: "x", contentEncoding: "utf8", sizeBytes: content.length };
      if (args.path === "/home/test/.claude/agents/b.md") return { content: "b body", sha256: "y", contentEncoding: "utf8", sizeBytes: 6 };
      throw new Error("no such file " + args.path);
    });
    const res = (await call("agentRefs", { path: "/home/test/.claude/agents/a.md", projectId: null })) as {
      content: string;
      refs: { label: string; path: string }[];
    };
    expect(res.content).toBe(content);
    expect(res.refs).toEqual([{ label: "b.md", path: "/home/test/.claude/agents/b.md" }]);
  });

  it("drops a path-escaping token even when a naive read of it would succeed (confinement)", async () => {
    const { harness, call } = setup({ homeDir: "/home/test" });
    const content = "escape ../../../etc/evil.md but keep normal.md";
    harness.sdk.stub("files.read", (args: any) => {
      if (args.path === "/home/test/.claude/agents/a.md") return { content, sha256: "x", contentEncoding: "utf8", sizeBytes: content.length };
      // every other candidate "reads" successfully — proves the escaping path is dropped by the
      // confinement check itself, not because the read happened to fail.
      return { content: "ok", sha256: "z", contentEncoding: "utf8", sizeBytes: 2 };
    });
    const res = (await call("agentRefs", { path: "/home/test/.claude/agents/a.md", projectId: null })) as {
      content: string;
      refs: { label: string; path: string }[];
    };
    expect(res.refs).toEqual([{ label: "normal.md", path: "/home/test/.claude/agents/normal.md" }]);
    expect(res.refs.some((r) => r.path.includes("etc/evil.md"))).toBe(false);
  });

  it("returns empty content and refs when the root file can't be read", async () => {
    const { harness, call } = setup({ homeDir: "/home/test" });
    harness.sdk.stub("files.read", () => {
      throw new Error("not found");
    });
    const res = (await call("agentRefs", { path: "/home/test/.claude/agents/missing.md", projectId: null })) as {
      content: string;
      refs: { label: string; path: string }[];
    };
    expect(res).toEqual({ content: "", refs: [] });
  });

  it("drops an ABSOLUTE ref token that escapes both roots, even when a naive read would succeed", async () => {
    const { harness, call } = setup({ homeDir: "/home/test" });
    const content = "absolute escape at /etc/evil.md, keep normal.md too";
    harness.sdk.stub("files.read", (args: any) => {
      if (args.path === "/home/test/.claude/agents/a.md") return { content, sha256: "x", contentEncoding: "utf8", sizeBytes: content.length };
      // every candidate "reads" successfully, including /etc/evil.md — only confinement can drop it
      return { content: "ok", sha256: "z", contentEncoding: "utf8", sizeBytes: 2 };
    });
    const res = (await call("agentRefs", { path: "/home/test/.claude/agents/a.md", projectId: null })) as {
      refs: { label: string; path: string }[];
    };
    expect(res.refs).toEqual([{ label: "normal.md", path: "/home/test/.claude/agents/normal.md" }]);
    expect(res.refs.some((r) => r.path === "/etc/evil.md")).toBe(false);
  });

  it("refuses to read a root path outside ~/.claude and the project source (arbitrary-file-read guard)", async () => {
    const { harness, call } = setup({ homeDir: "/home/test" });
    let readCalled = false;
    harness.sdk.stub("files.read", (args: any) => {
      readCalled = true;
      return { content: "root:x:0:0::/root:/bin/sh", sha256: "x", contentEncoding: "utf8", sizeBytes: 10 };
    });
    const res = await call("agentRefs", { path: "/etc/passwd", projectId: null });
    expect(res).toEqual({ content: "", refs: [] });
    expect(readCalled).toBe(false); // the root file must never even be read once it's out of bounds
  });

  it("resolves a bare SKILL.md reference under ~/.claude/skills/<name>/SKILL.md", async () => {
    const { harness, call } = setup({ homeDir: "/home/test" });
    const content = "uses the foo/SKILL.md skill";
    harness.sdk.stub("files.read", (args: any) => {
      if (args.path === "/home/test/.claude/agents/a.md") return { content, sha256: "x", contentEncoding: "utf8", sizeBytes: content.length };
      if (args.path === "/home/test/.claude/skills/foo/SKILL.md") return { content: "skill body", sha256: "y", contentEncoding: "utf8", sizeBytes: 10 };
      throw new Error("no such file " + args.path); // notably: NOT found next to a.md itself
    });
    const res = (await call("agentRefs", { path: "/home/test/.claude/agents/a.md", projectId: null })) as {
      content: string;
      refs: { label: string; path: string }[];
    };
    expect(res.refs).toEqual([{ label: "foo", path: "/home/test/.claude/skills/foo/SKILL.md" }]);
  });
});

describe("projects", () => {
  it("returns the project list mapped to id/name", async () => {
    const { harness, call } = setup();
    harness.sdk.stub("projects.list", () => [
      { id: "p1", kind: "standard", name: "Repo", sources: [], gitRemoteUrl: null, createdAt: 0, updatedAt: 0 },
      { id: "p2", kind: "standard", name: "Other", sources: [], gitRemoteUrl: null, createdAt: 0, updatedAt: 0 },
    ]);
    const res = (await call("projects", null)) as { id: string; name: string }[];
    expect(res).toEqual([
      { id: "p1", name: "Repo" },
      { id: "p2", name: "Other" },
    ]);
  });
});

describe("seedGlobalWorkflows", () => {
  // Real temp dirs on disk: the seed uses node:fs directly (the plugin's install dir is outside any
  // bb.sdk.files sandbox), so the test exercises the actual copy against the actual filesystem.
  const roots: string[] = [];
  function tmp(): string {
    const dir = mkdtempSync(join(tmpdir(), "wfseed-"));
    roots.push(dir);
    return dir;
  }
  afterEach(() => {
    while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
  });
  // Build an examples dir with the given files; return its path.
  function examplesWith(files: Record<string, string>): string {
    const dir = tmp();
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
    return dir;
  }

  it("copies bundled examples missing from the global store, skipping ones already present", () => {
    const examplesDir = examplesWith({ "parallel-dev.js": "DEV", "parallel-dev-full.js": "FULL" });
    const globalDir = tmp();
    writeFileSync(join(globalDir, "parallel-dev.js"), "USER EDIT"); // already present → keep it
    const seeded = seedGlobalWorkflows({ examplesDir, globalDir });
    expect(seeded).toEqual(["parallel-dev-full.js"]);
    expect(readFileSync(join(globalDir, "parallel-dev-full.js"), "utf8")).toBe("FULL");
    expect(readFileSync(join(globalDir, "parallel-dev.js"), "utf8")).toBe("USER EDIT"); // untouched
  });

  it("seeds every example when the global store dir does not exist yet", () => {
    const examplesDir = examplesWith({ "parallel-dev.js": "DEV", "parallel-dev-full.js": "FULL" });
    const globalDir = join(tmp(), "nested", "workflows"); // does not exist yet
    const seeded = seedGlobalWorkflows({ examplesDir, globalDir });
    expect(seeded.sort()).toEqual(["parallel-dev-full.js", "parallel-dev.js"]);
    expect(readFileSync(join(globalDir, "parallel-dev.js"), "utf8")).toBe("DEV");
  });

  it("ignores non-.js entries in the examples dir", () => {
    const examplesDir = examplesWith({ "parallel-dev.js": "DEV", "README.md": "docs" });
    const globalDir = tmp();
    const seeded = seedGlobalWorkflows({ examplesDir, globalDir });
    expect(seeded).toEqual(["parallel-dev.js"]);
    expect(existsSync(join(globalDir, "README.md"))).toBe(false);
  });

  it("does nothing and logs when there is no bundled examples dir (examplesDir undefined)", () => {
    const logs: string[] = [];
    const seeded = seedGlobalWorkflows({ examplesDir: undefined, globalDir: tmp(), log: (m) => logs.push(m) });
    expect(seeded).toEqual([]);
    expect(logs.some((l) => l.includes("no bundled examples dir"))).toBe(true);
  });

  it("does nothing and logs when the bundled examples dir is absent on disk", () => {
    const logs: string[] = [];
    const seeded = seedGlobalWorkflows({ examplesDir: "/no/such/examples", globalDir: tmp(), log: (m) => logs.push(m) });
    expect(seeded).toEqual([]);
    expect(logs.some((l) => l.includes("no bundled examples dir"))).toBe(true);
  });
});
