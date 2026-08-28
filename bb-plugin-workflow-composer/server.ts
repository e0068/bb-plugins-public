// bb-plugin-workflow-composer — backend entry.
//
// Owns everything the browser half cannot do: reading/writing workflow .js in the two stores
// (project `.bb/workflows/` and global `~/.claude/workflows/`), and driving `bb workflows` for
// validate/run/status. The tree ↔ .js transform lives in the DOM-free core (workflow-model.ts);
// this file is the "hands" — files, the bb CLI, and the model catalog — behind a typed RPC contract.
//
// The `bb workflows` CLI is reached through an injectable seam (WorkflowDeps.runBbCli) so tests
// drive the handlers without spawning a process. `createPlugin(bb, deps)` is the testable entry;
// the default export wires the real deps.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix as posixPath, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { compile, parse, readMetaDescription } from "./workflow-model";

// ---- RPC contract (the frontend data plane) ----

const storeEnum = z.enum(["project", "global"]);

const workflowItem = z.object({
  name: z.string(),
  path: z.string(),
  store: storeEnum,
  description: z.string(),
  hasTree: z.boolean(),
});

export const rpcContract = defineRpcContract({
  // Both stores, flattened. projectId may be null (no project in view) → project store is skipped.
  list: {
    input: z.object({ projectId: z.string().nullable() }).strict(),
    output: z.object({ items: z.array(workflowItem) }),
  },
  read: {
    input: z.object({ projectId: z.string().nullable(), store: storeEnum, path: z.string() }).strict(),
    output: z.object({ source: z.string(), tree: z.unknown().nullable() }),
  },
  save: {
    input: z
      .object({ projectId: z.string().nullable(), store: storeEnum, name: z.string(), source: z.string() })
      .strict(),
    output: z.object({ path: z.string() }),
  },
  remove: {
    input: z.object({ projectId: z.string().nullable(), store: storeEnum, path: z.string() }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  validate: {
    input: z.object({ projectId: z.string().nullable(), store: storeEnum, path: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), output: z.string() }),
  },
  run: {
    input: z.object({ projectId: z.string().nullable(), store: storeEnum, path: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), runId: z.string().nullable(), output: z.string() }),
  },
  status: {
    input: z.object({ runId: z.string() }).strict(),
    output: z.object({ output: z.string() }),
  },
  models: {
    input: z.null(),
    output: z.object({ models: z.array(z.string()) }),
  },
  // The projects a user can pick from in the header's project selector, so the panel isn't pinned to
  // whatever project the host happens to have in view.
  projects: {
    input: z.null(),
    output: z.array(z.object({ id: z.string(), name: z.string() })),
  },
  // Agent types discovered from user (~/.claude/agents), project (.claude/agents), and plugin
  // (~/.claude/plugins/**/agents) directories — feeds the "Agent type" autocomplete, plus each agent's
  // own model/effort/provider (read from its frontmatter) so the UI can follow the selected agent.
  // Every source scanned today sits under a `.claude` directory, so `provider` is always "claude-code".
  agents: {
    input: z.object({ projectId: z.string().nullable() }).strict(),
    output: z.object({
      agents: z.array(
        z.object({
          value: z.string(),
          model: z.string(),
          effort: z.string(),
          provider: z.string(),
          description: z.string(),
          path: z.string(),
          // Read-only: the engine takes tools from the agent .md's own frontmatter, never from an
          // agent() call argument — so the composer can only show them, not set them at call sites.
          tools: z.array(z.string()),
          // Which agents/ directory this agent was found in — the client uses it to route
          // writeAgent's overwrite back to the same source, and to disable Override for "plugin"
          // agents (plugin directories are never written to).
          scope: z.enum(["user", "project", "plugin"]),
        }),
      ),
    }),
  },
  // The live provider/model/effort catalog (bb.sdk.providers.list + .models per provider), so the agent
  // detail column can offer only a pinned agent's own provider's models and that model's efforts.
  providerCatalog: {
    input: z.null(),
    output: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        models: z.array(z.object({ id: z.string(), efforts: z.array(z.string()) })),
      }),
    ),
  },
  // Given an agent (or any) .md file's path, its content plus the .md/skill files it references that
  // actually exist on disk — feeds a drill-in UI so a workflow author can explore an agent's own
  // context (referenced skills, other docs) without leaving the composer.
  agentRefs: {
    input: z.object({ path: z.string(), projectId: z.string().nullable() }).strict(),
    output: z.object({
      content: z.string(),
      refs: z.array(z.object({ label: z.string(), path: z.string() })),
    }),
  },
  // Writes a full agent .md (frontmatter + body) to disk. The server is a "dumb writer": the client
  // assembles `content` in full; this handler only validates the name/scope and fences the write path.
  writeAgent: {
    input: z
      .object({
        projectId: z.string().nullable(),
        scope: z.enum(["user", "project"]),
        name: z.string(),
        content: z.string(),
        // true = Override Existing Agent (must already exist); false = Save as new (must NOT exist yet).
        overwrite: z.boolean(),
      })
      .strict(),
    output: z.object({ path: z.string() }),
  },
});

// ---- injectable seam for the bb CLI ----

export interface BbCliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface WorkflowDeps {
  // Run `bb <args>` and capture the result. cwd matters for a workflow's own relative resolution.
  runBbCli(args: string[], opts?: { cwd?: string }): Promise<BbCliResult>;
  // Absolute paths of every git worktree of a checkout (including the main one). Project workflows live
  // in each checkout's own `.bb/workflows`, so listing must union across them.
  gitWorktrees(root: string): Promise<string[]>;
  homeDir: string;
  // Absolute path of the plugin's bundled `examples/` dir, whose top-level .js are seeded into the
  // global store on load. Left undefined in tests that don't exercise seeding, which skips it entirely.
  examplesDir?: string;
}

// The server process is GUI-launched: no shell PATH and no BB_CLI in its env, so a bare "bb" spawn
// fails ENOENT. Resolve the bb CLI binary explicitly — BB_CLI if present, else next to the daemon
// executable (…/Contents/MacOS/bb → …/Contents/Resources/app.asar.unpacked/.../host-daemon/dist/bb),
// else via resourcesPath, else fall back to PATH.
export function resolveBbBin(): string {
  if (process.env.BB_CLI && existsSync(process.env.BB_CLI)) return process.env.BB_CLI;
  const candidates: string[] = [];
  if (process.execPath) {
    candidates.push(
      resolve(dirname(process.execPath), "..", "Resources", "app.asar.unpacked", "node_modules", "bb-app", "host-daemon", "dist", "bb"),
    );
  }
  const resourcesPath = (process as unknown as { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    candidates.push(join(resourcesPath, "app.asar.unpacked", "node_modules", "bb-app", "host-daemon", "dist", "bb"));
  }
  return candidates.find((p) => existsSync(p)) ?? "bb";
}

function defaultDeps(): WorkflowDeps {
  const bbBin = resolveBbBin();
  return {
    homeDir: homedir(),
    // bb.server points at `./server.ts`, so this module runs from `<pluginRoot>/server.ts`
    // and the bundled examples sit right beside it in `<pluginRoot>/examples`.
    examplesDir: join(dirname(fileURLToPath(import.meta.url)), "examples"),
    runBbCli(args, opts) {
      return new Promise((resolve) => {
        const child = spawn(bbBin, args, { cwd: opts?.cwd, env: process.env });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => (stdout += d.toString()));
        child.stderr.on("data", (d) => (stderr += d.toString()));
        child.on("error", (err) => resolve({ code: -1, stdout, stderr: stderr + String(err) }));
        child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
      });
    },
    gitWorktrees(root) {
      return new Promise((resolve) => {
        const child = spawn("git", ["-C", root, "worktree", "list", "--porcelain"], { env: process.env });
        let out = "";
        child.stdout.on("data", (d) => (out += d.toString()));
        child.on("error", () => resolve([]));
        child.on("close", () =>
          resolve(
            out
              .split("\n")
              .filter((l) => l.startsWith("worktree "))
              .map((l) => l.slice("worktree ".length).trim())
              .filter(Boolean),
          ),
        );
      });
    },
  };
}

// ---- store resolution ----

type Store = z.infer<typeof storeEnum>;

const WORKFLOW_EXT = ".js";
const WF_MARKER = "/.bb/workflows/"; // project workflows live directly under a checkout's .bb/workflows

function joinPath(...parts: string[]): string {
  return parts.join("/").replace(/\/+/g, "/");
}

function baseName(path: string): string {
  const seg = path.split("/").pop() ?? path;
  return seg.endsWith(WORKFLOW_EXT) ? seg.slice(0, -WORKFLOW_EXT.length) : seg;
}

// The project's default source (checkout root + its host).
async function projectSource(bb: BbPluginApi, projectId: string | null): Promise<{ hostId: string; path: string }> {
  if (!projectId) throw new Error("project store needs a project in view");
  const project = await bb.sdk.projects.get({ projectId });
  const source = project.sources.find((s) => s.isDefault) ?? project.sources[0];
  if (!source) throw new Error("project has no source path");
  return { hostId: source.hostId, path: source.path };
}

// The checkout root of a project workflow file, e.g. /repo/.bb/workflows/x.js → /repo.
function projectRootOf(path: string): string | null {
  const i = path.indexOf(WF_MARKER);
  return i === -1 ? null : path.slice(0, i);
}

// A project workflow file must sit DIRECTLY in some checkout's .bb/workflows — no nesting/traversal.
function assertProjectWorkflowPath(path: string): void {
  const i = path.indexOf(WF_MARKER);
  if (i === -1 || !path.endsWith(WORKFLOW_EXT)) throw new Error("not a project workflow path");
  if (path.slice(i + WF_MARKER.length).includes("/")) throw new Error("workflow must sit directly in .bb/workflows");
}

// A global (~/.claude/workflows) .js sitting directly in the store dir.
function assertGlobalPath(dir: string, path: string): void {
  if (!path.endsWith(WORKFLOW_EXT)) throw new Error("not a .js workflow file");
  if (path.slice(0, path.lastIndexOf("/")) !== dir.replace(/\/$/, "")) throw new Error("path is not directly inside the global store");
}

// ---- factory ----

export function createPlugin(bb: BbPluginApi, deps: WorkflowDeps = defaultDeps()) {
  bb.log.info("workflow-composer loaded; bb cli = " + resolveBbBin());

  const globalDir = joinPath(deps.homeDir, ".claude", "workflows");

  // Scan one directory for top-level workflow .js files, reading each to recover its description/tree.
  async function scanDir(hostId: string | undefined, dir: string, store: Store) {
    let entries: { path: string }[] = [];
    try {
      const res = await bb.sdk.files.listPaths({ hostId, path: dir, includeFiles: true, includeDirectories: false });
      entries = res.paths;
    } catch {
      return []; // dir does not exist
    }
    const items = [];
    for (const entry of entries) {
      if (entry.path.includes("/") || !entry.path.endsWith(WORKFLOW_EXT)) continue; // top-level .js only
      const abs = joinPath(dir, entry.path);
      let description = "";
      let hasTree = false;
      try {
        const file = await bb.sdk.files.read({ hostId, path: abs });
        const tree = parse(file.content);
        hasTree = tree !== null;
        // A composer-written file carries its description in the mirrored tree; a hand-written one has no
        // mirror, so fall back to its `export const meta` description rather than showing a blank row.
        description = tree?.description ?? readMetaDescription(file.content);
      } catch {
        // unreadable → list it minimally
      }
      items.push({ name: baseName(entry.path), path: abs, store, description, hasTree });
    }
    return items;
  }

  // Project workflows live in EVERY checkout of the project (main source + its git worktrees), so union
  // across them, deduped by name (first checkout wins).
  async function listProjectStore(projectId: string | null) {
    let src: { hostId: string; path: string };
    try {
      src = await projectSource(bb, projectId);
    } catch {
      return [];
    }
    const worktrees = await deps.gitWorktrees(src.path).catch(() => []);
    const roots = [...new Set([src.path, ...worktrees])];
    const byName = new Map<string, Awaited<ReturnType<typeof scanDir>>[number]>();
    for (const root of roots) {
      for (const item of await scanDir(src.hostId, joinPath(root, ".bb", "workflows"), "project")) {
        if (!byName.has(item.name)) byName.set(item.name, item);
      }
    }
    return [...byName.values()];
  }

  // hostId + working dir for an already-existing file (read/remove/validate/run).
  async function resolveFile(store: Store, projectId: string | null, path: string): Promise<{ hostId: string | undefined; cwd: string | undefined }> {
    if (store === "global") {
      assertGlobalPath(globalDir, path);
      return { hostId: undefined, cwd: undefined };
    }
    assertProjectWorkflowPath(path);
    const src = await projectSource(bb, projectId);
    return { hostId: src.hostId, cwd: projectRootOf(path) ?? undefined };
  }

  bb.rpc.register(rpcContract, {
    async list({ projectId }) {
      const [project, global] = await Promise.all([listProjectStore(projectId), scanDir(undefined, globalDir, "global")]);
      return { items: [...project, ...global] };
    },

    async read({ projectId, store, path }) {
      const { hostId } = await resolveFile(store, projectId, path);
      const file = await bb.sdk.files.read({ hostId, path });
      return { source: file.content, tree: parse(file.content) };
    },

    async save({ projectId, store, name, source }) {
      const slug = String(name).trim();
      if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error("name must be lowercase kebab-case");
      let hostId: string | undefined;
      let dir: string;
      if (store === "global") {
        hostId = undefined;
        dir = globalDir;
      } else {
        const src = await projectSource(bb, projectId);
        hostId = src.hostId;
        dir = joinPath(src.path, ".bb", "workflows"); // new project workflows land in the default checkout
      }
      const path = joinPath(dir, slug + WORKFLOW_EXT);
      await bb.sdk.files.write({ hostId, path, content: source, createParents: true });
      return { path };
    },

    async remove({ projectId, store, path }) {
      const { hostId } = await resolveFile(store, projectId, path);
      await bb.sdk.files.remove({ hostId, path });
      return { ok: true };
    },

    async validate({ projectId, store, path }) {
      const { cwd } = await resolveFile(store, projectId, path);
      const res = await deps.runBbCli(["workflows", "validate", "--file", path], { cwd });
      return { ok: res.code === 0, output: (res.stdout + res.stderr).trim() };
    },

    async run({ projectId, store, path }) {
      const { cwd } = await resolveFile(store, projectId, path);
      const res = await deps.runBbCli(["workflows", "run", "--file", path], { cwd });
      return { ok: res.code === 0, runId: extractRunId(res.stdout + res.stderr), output: (res.stdout + res.stderr).trim() };
    },

    async status({ runId }) {
      const res = await deps.runBbCli(["workflows", "status", runId]);
      return { output: (res.stdout + res.stderr).trim() };
    },

    async models() {
      return { models: await listModels(bb) };
    },

    async projects() {
      const list = await bb.sdk.projects.list();
      return list.map((p) => ({ id: p.id, name: p.name }));
    },

    async agents({ projectId }) {
      // value → its frontmatter-derived model/effort/provider/description + its file path. A Map (not a
      // Set) so each value carries its own detail; first source to discover a value wins, matching the
      // old Set's de-dup semantics.
      const found = new Map<
        string,
        { model: string; effort: string; provider: string; description: string; path: string; tools: string[]; scope: AgentScope }
      >();

      // Every agent source scanned here sits under a `.claude` directory, so provider is always
      // "claude-code" — the day a non-.claude source is added, that source computes its own provider.
      // `scope` records which of the three source directories this agent came from, so the client can
      // route writeAgent's overwrite back to the same source (and disable Override for "plugin").
      const addAgent = async (value: string, hostId: string | undefined, absPath: string, scope: AgentScope) => {
        if (found.has(value)) return;
        let model = "";
        let effort = "";
        let description = "";
        let tools: string[] = [];
        try {
          const file = await bb.sdk.files.read({ hostId, path: absPath });
          ({ model, effort, description, tools } = parseAgentFrontmatter(file.content));
        } catch {
          // unreadable → still list it, with blank model/effort/description/tools
        }
        found.set(value, { model, effort, provider: "claude-code", description, path: absPath, tools, scope });
      };

      const userDir = joinPath(deps.homeDir, ".claude", "agents");
      const userPaths = await listPathsSafe(bb, { path: userDir });
      for (const name of bareAgentNames(userPaths)) await addAgent(name, undefined, joinPath(userDir, name + ".md"), "user");

      if (projectId !== null) {
        try {
          const src = await projectSource(bb, projectId);
          const projectDir = joinPath(src.path, ".claude", "agents");
          const projectPaths = await listPathsSafe(bb, { hostId: src.hostId, path: projectDir });
          for (const name of bareAgentNames(projectPaths))
            await addAgent(name, src.hostId, joinPath(projectDir, name + ".md"), "project");
        } catch {
          // no resolvable project source → project agents skipped
        }
      }

      const pluginsDir = joinPath(deps.homeDir, ".claude", "plugins");
      const pluginPaths = await listPathsSafe(bb, { path: pluginsDir });
      for (const relPath of pluginPaths) {
        const name = pluginAgentName(relPath);
        if (name) await addAgent(name, undefined, joinPath(pluginsDir, relPath), "plugin");
      }

      const agents = [...found.entries()]
        .map(([value, detail]) => ({ value, ...detail }))
        .sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
      return { agents };
    },

    async providerCatalog() {
      const providers = await bb.sdk.providers.list();
      return Promise.all(
        providers.map(async (p) => {
          let models: { id: string; efforts: string[] }[] = [];
          try {
            const res = await bb.sdk.providers.models({ providerId: p.id });
            models = res.models.map((m) => ({ id: m.id, efforts: m.supportedReasoningEfforts.map((e) => e.reasoningEffort) }));
          } catch {
            // one provider's catalog failing shouldn't blank out the others
          }
          return { id: p.id, name: p.displayName || p.id, models };
        }),
      );
    },

    async agentRefs({ path, projectId }) {
      let projectSrc: { hostId: string; path: string } | null = null;
      if (projectId !== null) {
        try {
          projectSrc = await projectSource(bb, projectId);
        } catch {
          // no resolvable project source → refs stay confined to ~/.claude only
        }
      }
      const normPath = posixPath.normalize(path);
      const homeRoot = posixPath.normalize(deps.homeDir);
      const projectRoot = projectSrc ? posixPath.normalize(projectSrc.path) : null;
      const hostId = isWithin(normPath, homeRoot)
        ? undefined
        : projectSrc && projectRoot && isWithin(normPath, projectRoot)
          ? projectSrc.hostId
          : undefined;

      // CONFINEMENT: both the root file itself and every resolved ref must normalize into ~/.claude or
      // the project source root — this is what defeats a `../../etc/passwd`-style path/token, whether it
      // arrives as the RPC's own `path` argument or as a reference found inside a file's content.
      const claudeRoot = posixPath.normalize(joinPath(deps.homeDir, ".claude"));
      const isConfined = (p: string) => isWithin(p, claudeRoot) || (projectRoot !== null && isWithin(p, projectRoot));

      if (!isConfined(normPath)) return { content: "", refs: [] }; // never even read an out-of-bounds root path

      let content: string;
      try {
        content = (await bb.sdk.files.read({ hostId, path })).content;
      } catch {
        return { content: "", refs: [] };
      }

      const fromDir = posixPath.dirname(path);
      const tokens = content.match(MD_REF_RE) ?? [];
      const refs: { label: string; path: string }[] = [];
      const seen = new Set<string>();

      for (const token of tokens) {
        for (const candidate of candidatesForToken(token, fromDir, deps.homeDir)) {
          const norm = posixPath.normalize(candidate);
          if (!isConfined(norm)) continue; // escapes both roots → drop, never even read
          if (seen.has(norm)) break; // already resolved to this path via an earlier token
          try {
            await bb.sdk.files.read({ hostId, path: norm });
          } catch {
            continue; // this candidate doesn't exist → try the next one
          }
          seen.add(norm);
          refs.push({ label: agentRefLabel(norm), path: norm });
          break; // first existing, confined candidate wins for this token
        }
      }

      return { content, refs };
    },

    async writeAgent({ projectId, scope, name, content, overwrite }) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error("agent name must be lowercase kebab-case");

      let hostId: string | undefined;
      let dir: string;
      if (scope === "user") {
        hostId = undefined;
        dir = joinPath(deps.homeDir, ".claude", "agents");
      } else {
        const src = await projectSource(bb, projectId);
        hostId = src.hostId;
        dir = joinPath(src.path, ".claude", "agents");
      }

      const path = joinPath(dir, name + ".md");
      // FENCING: even though the kebab-case check above already rejects "/" and "..", normalize + confine
      // explicitly (matching the agentRefs style) so this guard doesn't silently rot if that check ever
      // loosens.
      if (!isWithin(posixPath.normalize(path), posixPath.normalize(dir))) throw new Error("agent path escapes its scope directory");

      if (!overwrite) {
        let exists = true;
        try {
          await bb.sdk.files.read({ hostId, path });
        } catch {
          exists = false;
        }
        if (exists) throw new Error("agent already exists");
      }

      await bb.sdk.files.write({ hostId, path, content, createParents: true });
      return { path };
    },
  });

  // Synchronous and best-effort: internally guarded so it can neither throw nor block load.
  seedGlobalWorkflows({ examplesDir: deps.examplesDir, globalDir, log: (m) => bb.log.info(`workflow-composer: ${m}`) });

  bb.onDispose(() => bb.log.info("workflow-composer disposed"));
}

// Seed the plugin's bundled default workflows (examples/*.js) into the global Claude Code store
// (~/.claude/workflows). Additive and never destructive: a name already present there is left
// untouched, so a user's own edits always win. Best-effort — every failure is logged and swallowed
// so a seed problem can't stop the plugin from loading. Returns the names actually written.
//
// Uses node:fs directly, NOT bb.sdk.files: both the plugin's own install dir and the global store are
// always local to the server process, and bb.sdk.files sandboxes reads to project/user roots — which
// silently excludes the plugin's install dir and made the earlier bb.sdk.files version a no-op. The
// logger is injected so tests can assert what was logged without a plugin host.
export function seedGlobalWorkflows(opts: {
  examplesDir: string | undefined;
  globalDir: string;
  log?: (message: string) => void;
}): string[] {
  const seeded: string[] = [];
  const log = opts.log ?? (() => {});
  const { examplesDir, globalDir } = opts;
  if (!examplesDir || !existsSync(examplesDir)) {
    log(`seed skipped: no bundled examples dir at ${examplesDir}`);
    return seeded;
  }
  let names: string[];
  try {
    names = readdirSync(examplesDir).filter((n) => n.endsWith(WORKFLOW_EXT));
  } catch (err) {
    log(`seed skipped: cannot read examples dir ${examplesDir}: ${String(err)}`);
    return seeded;
  }
  for (const name of names) {
    const dest = join(globalDir, name);
    if (existsSync(dest)) continue; // keep the user's copy
    try {
      mkdirSync(globalDir, { recursive: true });
      writeFileSync(dest, readFileSync(join(examplesDir, name)));
      seeded.push(name);
      log(`seeded default workflow ${name} into ${globalDir}`);
    } catch (err) {
      log(`failed to seed ${name}: ${String(err)}`);
    }
  }
  return seeded;
}

// `bb workflows run` prints JSON `{ "runId": "wfr_…" }`; fall back to scanning for a wfr_/wf_ token
// when the output is not clean JSON (e.g. warnings prepended).
export function extractRunId(text: string): string | null {
  try {
    const parsed = JSON.parse(text.trim());
    if (parsed && typeof parsed.runId === "string") return parsed.runId;
  } catch {
    // not clean JSON → fall through to a token scan
  }
  const m = text.match(/\bwfr?_[a-z0-9-]+/i);
  return m ? m[0] : null;
}

// ---- agent-type discovery ----

// Which agents/ directory an agent was discovered in — mirrors rpcContract.agents' output `scope`.
type AgentScope = "user" | "project" | "plugin";

// listPaths, but a missing directory (throw) yields [] instead of failing the caller.
async function listPathsSafe(bb: BbPluginApi, args: { hostId?: string; path: string }): Promise<string[]> {
  try {
    const res = await bb.sdk.files.listPaths({ ...args, includeFiles: true, includeDirectories: false });
    return res.paths.map((p) => p.path);
  } catch {
    return [];
  }
}

// Bare agent names from top-level (no "/") *.md files in a single agents dir.
function bareAgentNames(paths: string[]): string[] {
  return paths.filter((p) => !p.includes("/") && p.endsWith(".md")).map((p) => p.slice(0, -".md".length));
}

// Pull `model:`, `effort:`/`reasoningLevel:`, `description:`, and `tools:` out of an agent .md's
// frontmatter — the simple `key: value` block between the first pair of `---` lines. Missing/malformed
// frontmatter → "" for the scalars, [] for tools.
//
// `tools` supports both Claude Code agent .md syntaxes: an inline comma-separated string
// ("tools: Read, Grep, Glob") and a YAML list on the following indented "- Item" lines.
export function parseAgentFrontmatter(content: string): { model: string; effort: string; description: string; tools: string[] } {
  const lines = content.split("\n");
  let start = -1;
  let end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== "---") continue;
    if (start === -1) start = i;
    else {
      end = i;
      break;
    }
  }
  let model = "";
  let effort = "";
  let description = "";
  let tools: string[] = [];
  if (start !== -1 && end !== -1) {
    const body = lines.slice(start + 1, end);
    for (let i = 0; i < body.length; i++) {
      const m = body[i].match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
      if (!m) continue;
      const key = m[1].trim();
      const value = m[2].trim().replace(/^["']|["']$/g, "");
      if (key === "model") model = value;
      else if (key === "effort" || key === "reasoningLevel") effort = value;
      else if (key === "description") description = value;
      else if (key === "tools") {
        if (value) {
          tools = value
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
        } else {
          // Empty inline value → a YAML list follows on subsequent "- Item" lines.
          let j = i + 1;
          const items: string[] = [];
          while (j < body.length) {
            const listItem = body[j].match(/^\s*-\s*(.+?)\s*$/);
            if (!listItem) break;
            const item = listItem[1].trim();
            if (item) items.push(item);
            j++;
          }
          tools = items;
          i = j - 1; // resume scanning after the consumed list lines
        }
      }
    }
  }
  return { model, effort, description, tools };
}

// A candidate plugin-dir segment that is really a version tag ("1.0.0", "v2") or a content hash
// ("5e821f406d57") rather than the plugin's own name — skip it and step up one more segment.
const VERSION_LIKE = /^v?\d/;
const HASH_LIKE = /^[0-9a-f]{8,}$/;

// `<plugin>:<agent>` for a path (relative to ~/.claude/plugins) that is a *.md file sitting directly
// in an "agents" directory; null for anything else (nested docs, non-md files, etc).
export function pluginAgentName(relPath: string): string | null {
  const segments = relPath.split("/");
  const filename = segments[segments.length - 1];
  if (!filename || !filename.endsWith(".md")) return null;
  const agentsIdx = segments.length - 2;
  if (agentsIdx < 0 || segments[agentsIdx] !== "agents") return null;
  let pluginIdx = agentsIdx - 1;
  if (pluginIdx < 0) return null;
  const candidate = segments[pluginIdx];
  if (VERSION_LIKE.test(candidate) || HASH_LIKE.test(candidate)) {
    pluginIdx -= 1;
    if (pluginIdx < 0) return null;
  }
  const plugin = segments[pluginIdx];
  return `${plugin}:${filename.slice(0, -".md".length)}`;
}

// Live model catalog with a static fallback (the core's MODELS minus the empty "auto" slot).
async function listModels(bb: BbPluginApi): Promise<string[]> {
  const fallback = ["sonnet", "opus", "haiku", "fable", "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"];
  try {
    const res = await bb.sdk.providers.models();
    const ids = res.models.map((m) => m.id).filter(Boolean);
    return ids.length ? [...new Set(ids)].sort() : fallback;
  } catch {
    return fallback;
  }
}

// ---- agent ref discovery ----

// Loose token grammar for a .md reference embedded in file content — no markdown parsing, just
// candidate strings ending in ".md" that are later narrowed down to paths that actually exist.
const MD_REF_RE = /[A-Za-z0-9_@.\/-]+\.md/g;

// True when already-normalized `absPath` is `root` itself or sits somewhere under it.
function isWithin(absPath: string, root: string): boolean {
  return absPath === root || absPath.startsWith(root.endsWith("/") ? root : root + "/");
}

// Short readable name for a resolved ref: a SKILL.md's parent directory name (e.g. "foo" for
// ".../skills/foo/SKILL.md"), else the file's own basename.
export function agentRefLabel(absPath: string): string {
  const segs = absPath.split("/");
  const filename = segs[segs.length - 1] ?? absPath;
  if (filename === "SKILL.md" && segs.length >= 2) return segs[segs.length - 2];
  return filename;
}

// Ordered candidate absolute paths for one raw .md token found in a file's content: the token itself
// if absolute, the token relative to the referencing file's own directory, and — for a bare "SKILL.md"
// or "<name>/SKILL.md" token — that skill's canonical path under ~/.claude/skills.
function candidatesForToken(token: string, fromDir: string, homeDir: string): string[] {
  // An absolute-looking token is resolved ONLY as itself — it must never also fall back to being
  // joined onto fromDir, since e.g. "/etc/evil.md" joined onto an in-bounds fromDir would land back
  // inside the confined tree (".../fromDir/etc/evil.md") and smuggle the escaping token in disguise.
  const candidates: string[] = [token.startsWith("/") ? token : joinPath(fromDir, token)];
  const segs = token.split("/");
  if (segs[segs.length - 1] === "SKILL.md" && segs.length >= 2) {
    candidates.push(joinPath(homeDir, ".claude", "skills", segs[segs.length - 2], "SKILL.md"));
  }
  return candidates;
}

export default function plugin(bb: BbPluginApi) {
  createPlugin(bb);
}
