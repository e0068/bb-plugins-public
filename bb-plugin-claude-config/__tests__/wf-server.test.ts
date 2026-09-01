// Тесты workflow-конструктора, перенесённого из bb-plugin-workflow-composer/
// server.ts в этот сервер (см. server.ts, раздел «workflow-конструктор: чистые
// функции и общие типы» + «сием и обработчики»).
//
// Два слоя тестов:
//  - чистые функции модульного уровня — напрямую, без хоста;
//  - wf*-обработчики RPC — тем же харнессом, что и __tests__/server.test.ts:
//    createFakePluginHost + default-экспорт plugin(bb) + harness.behavior.callRpc.
//    Отдельной фабрики createPlugin(bb, deps) в этом сервере нет (сием инлайн
//    внутри plugin(bb)), но она и не нужна: обработчики регистрируются в тот
//    же bb.rpc.register, который поднимает и остальной сервер, так что тот же
//    харнесс их вызывает без всякой инъекции.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin, {
  extractRunId,
  parseAgentFrontmatter,
  pluginAgentName,
  agentRefLabel,
  resolveBbBin,
} from "../server";
import { compile, blankTree } from "../src/workflow/workflow-model";

describe("extractRunId", () => {
  it("prefers JSON runId, falls back to a token, else null", () => {
    expect(extractRunId('{"runId":"wfr_dead-beef"}')).toBe("wfr_dead-beef");
    expect(extractRunId("run wfr_deadbeef started")).toBe("wfr_deadbeef");
    expect(extractRunId("nothing here")).toBeNull();
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

  it("reads model/effort/description scalars from frontmatter", () => {
    const res = parseAgentFrontmatter("---\nmodel: opus\neffort: high\ndescription: Reviews code\n---\nBody");
    expect(res).toEqual({ model: "opus", effort: "high", description: "Reviews code", tools: [] });
  });

  it("accepts reasoningLevel as an alias for effort", () => {
    expect(parseAgentFrontmatter("---\nreasoningLevel: max\n---\n").effort).toBe("max");
  });

  it("returns all-blank scalars and no tools when there is no frontmatter fence", () => {
    expect(parseAgentFrontmatter("just a body, no frontmatter")).toEqual({
      model: "",
      effort: "",
      description: "",
      tools: [],
    });
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

describe("agentRefLabel", () => {
  it("uses the parent directory name for a SKILL.md", () => {
    expect(agentRefLabel("/home/test/.claude/skills/foo/SKILL.md")).toBe("foo");
  });

  it("falls back to the file's own basename otherwise", () => {
    expect(agentRefLabel("/home/test/.claude/agents/b.md")).toBe("b.md");
  });
});

describe("resolveBbBin", () => {
  const REAL_BB_CLI = process.env.BB_CLI;
  const tmpFiles: string[] = [];
  afterEach(() => {
    if (REAL_BB_CLI === undefined) delete process.env.BB_CLI;
    else process.env.BB_CLI = REAL_BB_CLI;
    while (tmpFiles.length) rmSync(tmpFiles.pop()!, { force: true });
  });

  it("uses BB_CLI when it points to an existing file", () => {
    const dir = mkdtempSync(join(tmpdir(), "wf-bbcli-"));
    const bin = join(dir, "bb");
    writeFileSync(bin, "#!/bin/sh\n");
    tmpFiles.push(bin);
    process.env.BB_CLI = bin;
    expect(resolveBbBin()).toBe(bin);
    rmSync(dir, { recursive: true, force: true });
  });

  it("falls back to the bare \"bb\" command when BB_CLI is unset and no bundled candidate exists", () => {
    delete process.env.BB_CLI;
    expect(resolveBbBin()).toBe("bb");
  });
});

// ---- wf*-обработчики RPC: тот же харнесс, что и __tests__/server.test.ts ----
//
// ВАЖНО про изоляцию: server.ts вычисляет wfHome = homedir() ОДИН РАЗ при
// вызове plugin(bb) (сием инлайн, инъекции homeDir нет — в отличие от
// bb-plugin-workflow-composer/server.ts, где homeDir приходил через
// WorkflowDeps). Пути wf*-обработчиков (личные agents/, глобальный workflows/
// store) собираются от этого wfHome — без подмены пути в ассертах ниже
// (join(homeDir, ".claude", ...)) зависели бы от реального домашнего каталога
// машины и были бы недетерминированы. os.homedir() на этой платформе читает
// $HOME (проверено), поэтому каждый setup() перед вызовом plugin(bb) подменяет
// $HOME на одноразовый temp-каталог и возвращает его в afterEach.
const REAL_HOME = process.env.HOME;
const fakeHomeDirs: string[] = [];

afterEach(() => {
  if (REAL_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = REAL_HOME;
  while (fakeHomeDirs.length) rmSync(fakeHomeDirs.pop()!, { recursive: true, force: true });
});

function setup() {
  const homeDir = mkdtempSync(join(tmpdir(), "wf-rpc-home-"));
  fakeHomeDirs.push(homeDir);
  process.env.HOME = homeDir;
  const { bb, harness } = createFakePluginHost({ pluginId: "claude-config" });
  plugin(bb);
  return { bb, harness, homeDir, call: (m: string, i?: unknown) => harness.behavior.callRpc(m, i) };
}

// Единственный источник проекта, используемый во всех wf*-тестах ниже:
// checkout "/repo" на хосте "h1". gitWorktrees(root) в server.ts спавнит
// настоящий `git -C <root> worktree list` без сида — "/repo" не существует на
// диске, поэтому git детерминированно ошибается и функция глотает ошибку в [];
// итоговый набор корней union'а — ровно [src.path], так что дедуп по нескольким
// чекаутам здесь не проверяется (см. задание группы: «обойди одним корнем»).
function stubProject(harness: ReturnType<typeof createFakePluginHost>["harness"]) {
  harness.sdk.stub("projects.get", () => ({
    id: "p1",
    kind: "standard",
    name: "Repo",
    sources: [{ id: "s1", hostId: "h1", isDefault: true, path: "/repo", projectId: "p1", type: "local_path", createdAt: 0, updatedAt: 0 }],
    gitRemoteUrl: null,
    createdAt: 0,
    updatedAt: 0,
  }));
}

describe("wfWriteAgent", () => {
  it("rejects a path-traversal name before touching any file", async () => {
    const { call } = setup();
    await expect(
      call("wfWriteAgent", { projectId: null, scope: "user", name: "../evil", content: "x", overwrite: true }),
    ).rejects.toBeTruthy();
  });

  it("rejects a non-kebab-case name (uppercase/space)", async () => {
    const { call } = setup();
    await expect(
      call("wfWriteAgent", { projectId: null, scope: "user", name: "Bad Name", content: "x", overwrite: true }),
    ).rejects.toBeTruthy();
  });

  it("rejects overwrite:false when the agent already exists", async () => {
    const { harness, call } = setup();
    harness.sdk.stub("files.read", () => ({ content: "existing", sha256: "x", contentEncoding: "utf8", sizeBytes: 8 }));
    await expect(
      call("wfWriteAgent", { projectId: null, scope: "user", name: "existing-agent", content: "new", overwrite: false }),
    ).rejects.toBeTruthy();
  });

  it("scope user: writes to <homeDir>/.claude/agents/<name>.md with no hostId", async () => {
    const { harness, homeDir, call } = setup();
    let written: any = null;
    harness.sdk.stub("files.write", (args: any) => {
      written = args;
      return { outcome: "written", sha256: "x", sizeBytes: 3 };
    });
    const res = (await call("wfWriteAgent", {
      projectId: null,
      scope: "user",
      name: "my-agent",
      content: "---\nmodel: opus\n---\nBody",
      overwrite: true,
    })) as { path: string };
    expect(res.path).toBe(join(homeDir, ".claude", "agents", "my-agent.md"));
    expect(written.path).toBe(res.path);
    expect(written.content).toBe("---\nmodel: opus\n---\nBody");
    expect(written.createParents).toBe(true);
    expect(written.hostId).toBeUndefined();
  });

  it("scope project: writes to <projectPath>/.claude/agents/<name>.md with the project's hostId", async () => {
    const { harness, call } = setup();
    stubProject(harness);
    let written: any = null;
    harness.sdk.stub("files.write", (args: any) => {
      written = args;
      return { outcome: "written", sha256: "x", sizeBytes: 3 };
    });
    const res = (await call("wfWriteAgent", {
      projectId: "p1",
      scope: "project",
      name: "my-agent",
      content: "body",
      overwrite: true,
    })) as { path: string };
    expect(res.path).toBe("/repo/.claude/agents/my-agent.md");
    expect(written.hostId).toBe("h1");
  });
});

describe("wfRead / wfRemove — path fencing via wfResolveFile", () => {
  it("rejects a global path that sits outside the global store dir", async () => {
    const { call } = setup();
    await expect(call("wfRead", { projectId: null, store: "global", path: "/etc/evil.js" })).rejects.toBeTruthy();
  });

  it("rejects a project path nested under .bb/workflows (no direct-child guarantee)", async () => {
    const { call } = setup();
    await expect(
      call("wfRead", { projectId: "p1", store: "project", path: "/repo/.bb/workflows/sub/x.js" }),
    ).rejects.toBeTruthy();
  });

  it("reads a valid global path (no CLI, no spawn involved)", async () => {
    const { harness, homeDir, call } = setup();
    const src = compile(blankTree("g"));
    const path = join(homeDir, ".claude", "workflows", "g.js");
    harness.sdk.stub("files.read", () => ({ content: src, sha256: "x", contentEncoding: "utf8", sizeBytes: src.length }));
    const res = (await call("wfRead", { projectId: null, store: "global", path })) as { source: string; tree: any };
    expect(res.source).toBe(src);
    expect(res.tree.name).toBe("g");
  });

  it("reads a valid project path and removes it, both without invoking the bb CLI", async () => {
    const { harness, call } = setup();
    stubProject(harness);
    const src = compile(blankTree("z"));
    harness.sdk.stub("files.read", () => ({ content: src, sha256: "x", contentEncoding: "utf8", sizeBytes: src.length }));
    const read = (await call("wfRead", { projectId: "p1", store: "project", path: "/repo/.bb/workflows/z.js" })) as {
      source: string;
      tree: any;
    };
    expect(read.tree.name).toBe("z");

    let removed: any = null;
    harness.sdk.stub("files.remove", (args: any) => {
      removed = args;
      return { outcome: "removed" };
    });
    const res = (await call("wfRemove", { projectId: "p1", store: "project", path: "/repo/.bb/workflows/z.js" })) as { ok: boolean };
    expect(res.ok).toBe(true);
    expect(removed.path).toBe("/repo/.bb/workflows/z.js");
  });
});

describe("wfValidate / wfRun — reject before spawning the bb CLI on a fenced-out path", () => {
  // Ветка «валидный путь → реально спавнит bb» здесь намеренно не тестируется:
  // runBbCli/gitWorktrees в server.ts спавнят настоящий процесс без сида (по
  // заданию группы), так что детерминированно проверяется только throw-ветка
  // wfResolveFile, случающаяся ДО всякого spawn.
  it("wfValidate rejects a global path outside the store dir without spawning", async () => {
    const { call } = setup();
    await expect(call("wfValidate", { projectId: null, store: "global", path: "/etc/evil.js" })).rejects.toBeTruthy();
  });

  it("wfRun rejects a nested project path without spawning", async () => {
    const { call } = setup();
    await expect(
      call("wfRun", { projectId: "p1", store: "project", path: "/repo/.bb/workflows/sub/x.js" }),
    ).rejects.toBeTruthy();
  });
});

describe("wfList / wfScanDir", () => {
  it("lists only top-level .js of the project store; nested and non-.js are dropped", async () => {
    const { harness, call } = setup();
    stubProject(harness);
    const src = compile({ ...blankTree("a"), description: "hi there" });
    harness.sdk.stub("files.listPaths", (args: any) => {
      if (args.path === "/repo/.bb/workflows") {
        return { paths: [{ path: "a.js" }, { path: "nested/b.js" }, { path: "c.txt" }], truncated: false };
      }
      throw new Error("no such dir"); // global store dir missing on the fake HOME → skipped
    });
    harness.sdk.stub("files.read", () => ({ content: src, sha256: "x", contentEncoding: "utf8", sizeBytes: src.length }));
    const res = (await call("wfList", { projectId: "p1" })) as { items: any[] };
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({ name: "a", store: "project", hasTree: true, description: "hi there", path: "/repo/.bb/workflows/a.js" });
  });

  it("falls back to the meta description for a hand-written workflow with no composer tree", async () => {
    const { harness, call } = setup();
    stubProject(harness);
    const handWritten =
      "export const meta = {\n  name: 'hand',\n  description: 'does a hand-written thing',\n  phases: [],\n}\nphase('P')\nawait agent('hi', {})\n";
    harness.sdk.stub("files.listPaths", (args: any) => {
      if (args.path === "/repo/.bb/workflows") return { paths: [{ path: "hand.js" }], truncated: false };
      throw new Error("no such dir");
    });
    harness.sdk.stub("files.read", () => ({ content: handWritten, sha256: "x", contentEncoding: "utf8", sizeBytes: handWritten.length }));
    const res = (await call("wfList", { projectId: "p1" })) as { items: any[] };
    expect(res.items[0]).toMatchObject({ name: "hand", hasTree: false, description: "does a hand-written thing" });
  });

  it("returns an empty list when there is no project in view and the global store is empty", async () => {
    const { call } = setup();
    const res = (await call("wfList", { projectId: null })) as { items: any[] };
    expect(res.items).toEqual([]);
  });
});

describe("wfSave", () => {
  it("rejects a non-kebab-case name", async () => {
    const { call } = setup();
    await expect(call("wfSave", { projectId: "p1", store: "project", name: "Bad", source: "S" })).rejects.toBeTruthy();
    await expect(call("wfSave", { projectId: "p1", store: "project", name: "-x", source: "S" })).rejects.toBeTruthy();
  });

  it("writes the .js into the project store at the derived path", async () => {
    const { harness, call } = setup();
    stubProject(harness);
    let written: any = null;
    harness.sdk.stub("files.write", (args: any) => {
      written = args;
      return { outcome: "written", sha256: "x", sizeBytes: 3 };
    });
    const res = (await call("wfSave", { projectId: "p1", store: "project", name: "my-flow", source: "SRC" })) as { path: string };
    expect(res.path).toBe("/repo/.bb/workflows/my-flow.js");
    expect(written.path).toBe("/repo/.bb/workflows/my-flow.js");
    expect(written.content).toBe("SRC");
    expect(written.hostId).toBe("h1");
    expect(written.createParents).toBe(true);
  });

  it("writes the global store under <homeDir>/.claude/workflows with no hostId", async () => {
    const { harness, homeDir, call } = setup();
    let written: any = null;
    harness.sdk.stub("files.write", (args: any) => {
      written = args;
      return { outcome: "written", sha256: "x", sizeBytes: 3 };
    });
    const res = (await call("wfSave", { projectId: null, store: "global", name: "g", source: "S" })) as { path: string };
    expect(res.path).toBe(join(homeDir, ".claude", "workflows", "g.js"));
    expect(written.hostId).toBeUndefined();
  });
});
