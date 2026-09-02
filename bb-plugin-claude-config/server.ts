// bb-plugin-claude-config — backend: area resolution, reading and writing
// Claude Code settings files, and the RPC contract for the panel.
//
// I/O layer. All logic for building the view and editing the document lives
// in pure, test-covered modules under src/; here it's just wiring: resolve
// area paths, read files, hand them to the pure layer, write the result with
// CAS protection, and turn a conflict/corrupt file into a response rather
// than an exception.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix as posixPath, resolve } from "node:path";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

import * as sd from "./src/settings-doc";
import { HookDefinitionParseError, SettingsParseError } from "./src/settings-doc";
import {
  decideMcpOwn,
  resolvePlugin,
  resolveSkill,
  resolveToolSearch,
} from "./src/effective";
import { buildConfigView } from "./src/config-view";
import { estimateTokens } from "./src/weight";
import {
  parseClaudeJsonServers,
  parseInstalledPlugins,
  parseMcpJson,
} from "./src/catalog";
import { parseImports, resolveImportPath } from "./src/imports";
import { extractCommandFile } from "./src/hook-script";
import {
  agentTemplate,
  isValidName,
  skillTemplate,
  slugifyName,
} from "./src/scaffold";
// Direct import of the pure module (not the barrel index): otherwise the
// server would pull the React component MdDocView and its CSS into the
// server bundle.
import {
  NATIVE_VIEWER_TOKEN_DEFAULTS,
  buildDescriptors,
} from "./packages/md-doc-view/kasimov-settings";
// Port of the workflow builder (bb-plugin-workflow-composer → here): the
// tree<->.js core stays a DOM-free module under src/workflow; the server
// here only reads/writes files and calls `bb workflows` — same as in the
// original plugin.
import { parse as parseWorkflow, readMetaDescription } from "./src/workflow/workflow-model";

// --- schemas shared between the server and the panel --------------------

// Enabled-skill mode (without off) and write target (including off).
// "inherit" isn't exposed in the contract: the panel doesn't operate on it,
// the server itself decides when to keep the key and when to drop it.
const skillMode = z.enum(["on", "name-only", "user-invocable-only"]);
const skillTarget = z.enum(["on", "name-only", "user-invocable-only", "off"]);
// Tool search loading: mode when enabled (Always/Auto) and write target (+off).
const toolSearchModeOn = z.enum(["on", "auto"]);
const toolSearchTarget = z.enum(["on", "off", "auto"]);

// Write outcome: ok — written; conflict — file changed under us; parse-error —
// file can't be safely edited; not-found — area didn't resolve.
const writeResult = z.object({
  outcome: z.enum(["ok", "conflict", "parse-error", "not-found"]),
  message: z.string().nullable(),
});

// Outcome of creating a skill/agent. `created` — file written, `path` points
// to it (the panel opens it); `exists` — a file with that name already
// exists; `invalid` — no valid characters remained in the input; `not-found`
// — area not found.
const createResult = z.object({
  outcome: z.enum(["created", "exists", "invalid", "not-found"]),
  path: z.string().nullable(),
  message: z.string().nullable(),
});

// Document contents: the panel needs `sha256` for a CAS write on edit.
const docContent = z.object({
  path: z.string(),
  content: z.string().nullable(),
  error: z.string().nullable(),
  sha256: z.string().nullable(),
});

// Hook for the right-hand tab: unlike `docContent`, returns the raw command
// (not markdown) and `sha256`, so the panel can edit and save it via
// `writeHook` with CAS. `event`/`matcher` are for the tab title.
// `definition` — the whole hook as JSON (context for display), `filePath`/
// `fileContent` — the file the command reads or runs (`cat x.json`,
// `bash foo.sh`), if it's recognized and read within the area's bounds.
const hookDetail = z.object({
  path: z.string(),
  command: z.string().nullable(),
  error: z.string().nullable(),
  sha256: z.string().nullable(),
  event: z.string().nullable(),
  matcher: z.string().nullable(),
  definition: z.string().nullable(),
  filePath: z.string().nullable(),
  fileContent: z.string().nullable(),
  // sha256 of the referenced file's content — CAS for editing it in place
  // via writeDoc, same as any other file (see hookDetail's own sha256 for
  // the settings.json entry itself).
  fileSha256: z.string().nullable(),
});

const configOutput = z.object({
  areaLabel: z.string(),
  editedFilePath: z.string(),
  error: z
    .object({ file: z.string(), message: z.string() })
    .nullable(),
  plugins: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      marketplace: z.string(),
      version: z.string().nullable(),
      // Switch state (effective on/off) and row dimming: in the project,
      // true if it matches the global value; globally, always false.
      value: z.boolean(),
      dimmed: z.boolean(),
      // Plugin directory — present if the row can be opened.
      installPath: z.string().nullable(),
      // Estimated "weight" in tokens (manifest+README); null — couldn't read it.
      tokens: z.number().nullable(),
    }),
  ),
  connectors: z.array(
    z.object({
      name: z.string(),
      origin: z.enum(["mcpjson", "user", "local"]),
      transport: z.string(),
      // toggleable — only .mcp.json servers; for read-only, value is always true.
      toggleable: z.boolean(),
      value: z.boolean(),
      dimmed: z.boolean(),
      // Estimated weight of the connector definition in tokens.
      tokens: z.number().nullable(),
    }),
  ),
  skills: z.array(
    z.object({
      name: z.string(),
      origin: z.enum(["personal", "project"]),
      // Toggle (on/off) and mode when enabled; in the project, dimmed means
      // it matches the global value.
      enabled: z.boolean(),
      mode: skillMode,
      dimmed: z.boolean(),
      // Absolute path to SKILL.md — the panel opens it with the host opener.
      // null — orphaned skill (the override entry remains, but no file on disk).
      path: z.string().nullable(),
      // Estimated weight of SKILL.md in tokens.
      tokens: z.number().nullable(),
    }),
  ),
  agents: z.array(
    z.object({
      name: z.string(),
      origin: z.enum(["personal", "project"]),
      // Absolute path to the agent file — the panel opens it via this path.
      path: z.string(),
      // Estimated weight of the agent file in tokens.
      tokens: z.number().nullable(),
    }),
  ),
  hooks: z.array(
    z.object({
      event: z.string(),
      matcher: z.string().nullable(),
      command: z.string(),
      origin: z.enum(["user", "project", "local"]),
      // Position in the level's flat hook list, as in readHook/writeHook —
      // except -1, the sentinel `buildHooks` gives a disabled hook: it has
      // no position, having been cut out of the file entirely.
      index: z.number().int(),
      // false — the hook has been cut out of the file and lives in the
      // disabled store (see setHookEnabled).
      enabled: z.boolean(),
    }),
  ),
  toolSearch: z.object({
    enabled: z.boolean(),
    mode: toolSearchModeOn,
    dimmed: z.boolean(),
  }),
});

// --- workflow builder schemas (port of bb-plugin-workflow-composer) -----
// Verbatim from its rpcContract; keys here carry a wf prefix so they don't
// collide with this plugin's identically named procedures (list/read/save
// etc. are already taken by the settings areas).

const wfStoreEnum = z.enum(["project", "global"]);

const wfWorkflowItem = z.object({
  name: z.string(),
  path: z.string(),
  store: wfStoreEnum,
  description: z.string(),
  hasTree: z.boolean(),
});

/** getConfig response — the panel imports this type to stay in sync. */
export type AreaConfig = z.infer<typeof configOutput>;
/** Outcome of any edit — the panel uses the same type. */
export type WriteOutcome = z.infer<typeof writeResult>;

export const rpcContract = defineRpcContract({
  listAreas: {
    input: z.null(),
    output: z.object({
      areas: z.array(z.object({ id: z.string(), label: z.string() })),
    }),
  },
  getConfig: {
    input: z.object({ areaId: z.string() }).strict(),
    output: configOutput,
  },
  setPlugin: {
    // The switch is binary: value — the desired effective on/off in this area.
    input: z
      .object({ areaId: z.string(), key: z.string(), value: z.boolean() })
      .strict(),
    output: writeResult,
  },
  setConnector: {
    // .mcp.json server toggle: value — the desired effective on/off in the area.
    input: z
      .object({ areaId: z.string(), name: z.string(), value: z.boolean() })
      .strict(),
    output: writeResult,
  },
  setSkill: {
    input: z
      .object({ areaId: z.string(), name: z.string(), state: skillTarget })
      .strict(),
    output: writeResult,
  },
  setToolSearch: {
    input: z.object({ areaId: z.string(), mode: toolSearchTarget }).strict(),
    output: writeResult,
  },
  readConnector: {
    // Server definition as JSON for the right-hand tab. origin selects the
    // source: the project's .mcp.json or the mcpServers sections in
    // ~/.claude.json (user/local).
    input: z
      .object({
        areaId: z.string(),
        name: z.string(),
        origin: z.enum(["mcpjson", "user", "local"]),
      })
      .strict(),
    output: docContent,
  },
  readHook: {
    // Hook command for the right-hand tab. origin selects the level (settings
    // file), index — the position in that level's hook list (as in
    // getConfig). Unlike readConnector/readSkillFile, this returns the raw
    // command and sha256 — the panel can edit it (see writeHook).
    input: z
      .object({
        areaId: z.string(),
        origin: z.enum(["user", "project", "local"]),
        index: z.number().int().nonnegative(),
      })
      .strict(),
    output: hookDetail,
  },
  writeHook: {
    // Save the edited hook command with CAS: expectedSha256 comes from readHook.
    input: z
      .object({
        areaId: z.string(),
        origin: z.enum(["user", "project", "local"]),
        index: z.number().int().nonnegative(),
        command: z.string(),
        expectedSha256: z.string().nullable(),
      })
      .strict(),
    output: z.object({
      outcome: z.enum(["written", "conflict", "denied", "not-found"]),
      sha256: z.string().nullable(),
      message: z.string().nullable(),
    }),
  },
  writeHookDefinition: {
    // Save the edited "Definition" JSON with CAS: parses it back into
    // event/matcher/command (see parseHookDefinitionJson) and replaces the
    // hook at `index`, moving it to a different event or matcher group if
    // those changed (see sd.replaceHook). A parse error is reported as
    // `denied`, same as a corrupt settings file — both are "can't write
    // this", not a crash.
    input: z
      .object({
        areaId: z.string(),
        origin: z.enum(["user", "project", "local"]),
        index: z.number().int().nonnegative(),
        definition: z.string(),
        expectedSha256: z.string().nullable(),
      })
      .strict(),
    output: z.object({
      outcome: z.enum(["written", "conflict", "denied", "not-found"]),
      sha256: z.string().nullable(),
      message: z.string().nullable(),
    }),
  },
  setHookEnabled: {
    // Hook toggle: disabling cuts the entry out of the level's file and
    // stores it in kv (disabledHooks:<path>); enabling puts it back. The
    // hook's identity is event+matcher+command (see sameHook); index
    // positions aren't used for this, since they shift on every file edit.
    input: z
      .object({
        areaId: z.string(),
        origin: z.enum(["user", "project", "local"]),
        event: z.string(),
        matcher: z.string().nullable(),
        command: z.string(),
        enabled: z.boolean(),
      })
      .strict(),
    output: writeResult,
  },
  readSkillFile: {
    // Skill name — from the directory (no `/`, so it can't escape skills).
    // `relPath` — a link inside SKILL.md relative to its folder; escaping the
    // skill's folder is cut off by `rootPath` at read time, here it's just a
    // coarse character filter.
    input: z
      .object({
        areaId: z.string(),
        name: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/),
        relPath: z.string().regex(/^[a-zA-Z0-9._/-]{1,300}$/),
      })
      .strict(),
    output: docContent,
  },
  listMemory: {
    // Memory files available in the area: base candidates plus their
    // @-imports, resolved transitively (CLAUDE.md -> skills -> their own
    // imports). Only files that actually exist.
    input: z.object({ areaId: z.string() }).strict(),
    output: z.object({
      entries: z.array(
        z.object({ id: z.string(), label: z.string(), path: z.string() }),
      ),
    }),
  },
  listRefTargets: {
    // Full list of targets that can be referenced via @ (skills and memory
    // files); ranking by query happens on the panel, via suggest.rankCandidates.
    input: z.object({ areaId: z.string() }).strict(),
    output: z.object({
      targets: z.array(
        z.object({
          value: z.string(),
          label: z.string(),
          kind: z.enum(["skill", "memory"]),
        }),
      ),
    }),
  },
  readDoc: {
    // Reads any file within the area's bounds (the `.claude` root and the
    // project root). The absolute path comes from the UI (plugin README,
    // memory file, a link inside the document), but escaping either root is
    // cut off on the server.
    input: z.object({ areaId: z.string(), path: z.string() }).strict(),
    output: docContent,
  },
  listDocPaths: {
    // Path suggestions for / and @ in the editor: files in the subtree of
    // the document's folder, paths relative to it. Within the area's bounds;
    // on error, silently returns [].
    input: z.object({ areaId: z.string(), path: z.string() }).strict(),
    output: z.object({ paths: z.array(z.string()) }),
  },
  resolveOpenTarget: {
    // Host for a file within the area's bounds: the panel opens it with bb's
    // native opener (experimental_openFilePreview) targeting
    // { kind: "host", hostId, path }. For project files — the project
    // source's host, for personal ones (~/.claude) — the server's
    // primaryHostId. hostId=null — the path is out of bounds or the host is
    // unknown.
    input: z.object({ areaId: z.string(), path: z.string() }).strict(),
    output: z.object({
      hostId: z.string().nullable(),
      error: z.string().nullable(),
    }),
  },
  readPlugin: {
    // Plugin reference: the manifest (definition) and README, if present.
    input: z.object({ areaId: z.string(), key: z.string() }).strict(),
    output: z.object({
      manifestPath: z.string(),
      manifest: z.string().nullable(),
      readmePath: z.string().nullable(),
      readme: z.string().nullable(),
      error: z.string().nullable(),
    }),
  },
  writeDoc: {
    // Save the edited document with CAS: expectedSha256 comes from readDoc.
    // Same area bounds as reading. sha256 on success is the new one, so
    // editing can continue without re-reading.
    input: z
      .object({
        areaId: z.string(),
        path: z.string(),
        content: z.string(),
        expectedSha256: z.string().nullable(),
      })
      .strict(),
    output: z.object({
      outcome: z.enum(["written", "conflict", "denied", "not-found"]),
      sha256: z.string().nullable(),
      message: z.string().nullable(),
    }),
  },
  createSkill: {
    // Creates a new skill `<slug>/SKILL.md` in the area's skills directory
    // (project skills dir in a project, personal one globally). The name is
    // normalized into a slug on the server. `exists` — a skill with that
    // slug already exists (create-only doesn't overwrite).
    input: z.object({ areaId: z.string(), name: z.string() }).strict(),
    output: createResult,
  },
  createAgent: {
    // Creates a new agent file `<slug>.md` in the area's agents directory.
    // Directory selection and name normalization rules are the same as
    // createSkill.
    input: z.object({ areaId: z.string(), name: z.string() }).strict(),
    output: createResult,
  },

  // ---- workflow builder (port of bb-plugin-workflow-composer) ----
  // Both stores (project `.bb/workflows/` + global `~/.claude/workflows/`),
  // flattened into one list. projectId can be null (no project in focus)
  // -> the project store is skipped.
  wfList: {
    input: z.object({ projectId: z.string().nullable() }).strict(),
    output: z.object({ items: z.array(wfWorkflowItem) }),
  },
  wfRead: {
    input: z
      .object({ projectId: z.string().nullable(), store: wfStoreEnum, path: z.string() })
      .strict(),
    output: z.object({ source: z.string(), tree: z.unknown().nullable() }),
  },
  wfSave: {
    input: z
      .object({
        projectId: z.string().nullable(),
        store: wfStoreEnum,
        name: z.string(),
        source: z.string(),
      })
      .strict(),
    output: z.object({ path: z.string() }),
  },
  wfRemove: {
    input: z
      .object({ projectId: z.string().nullable(), store: wfStoreEnum, path: z.string() })
      .strict(),
    output: z.object({ ok: z.boolean() }),
  },
  wfValidate: {
    input: z
      .object({ projectId: z.string().nullable(), store: wfStoreEnum, path: z.string() })
      .strict(),
    output: z.object({ ok: z.boolean(), output: z.string() }),
  },
  wfRun: {
    input: z
      .object({ projectId: z.string().nullable(), store: wfStoreEnum, path: z.string() })
      .strict(),
    output: z.object({ ok: z.boolean(), runId: z.string().nullable(), output: z.string() }),
  },
  wfStatus: {
    input: z.object({ runId: z.string() }).strict(),
    output: z.object({ output: z.string() }),
  },
  // Projects selectable in the header selector — the panel isn't tied
  // exclusively to whichever project the host currently has in focus.
  wfProjects: {
    input: z.null(),
    output: z.array(z.object({ id: z.string(), name: z.string() })),
  },
  // Agent types from personal (~/.claude/agents), project (.claude/agents),
  // and plugin (~/.claude/plugins/**/agents) directories — autocomplete for
  // "Agent type", plus the agent's own model/effort/provider (from frontmatter).
  wfAgents: {
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
          tools: z.array(z.string()),
          scope: z.enum(["user", "project", "plugin"]),
        }),
      ),
    }),
  },
  // Live provider/model/effort catalog (bb.sdk.providers.list + .models per
  // provider) for the agent details column.
  wfProviderCatalog: {
    input: z.null(),
    output: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        models: z.array(z.object({ id: z.string(), efforts: z.array(z.string()) })),
      }),
    ),
  },
  // Writes the full agent .md (frontmatter + body) to disk. The server is a
  // "dumb writer": the client assembles the content, here it's only
  // name/area validation and fencing the write path.
  wfWriteAgent: {
    input: z
      .object({
        projectId: z.string().nullable(),
        scope: z.enum(["user", "project"]),
        name: z.string(),
        content: z.string(),
        overwrite: z.boolean(),
      })
      .strict(),
    output: z.object({ path: z.string() }),
  },
});

// --- workflow builder: pure functions and shared types (port) -----------
// Ported verbatim from bb-plugin-workflow-composer/server.ts: module-level
// pure functions plus the private helpers the ported wf*-handlers require.
// The agentRefs/models handlers stayed in the original plugin and weren't
// ported here — along with them, their own helpers (MD_REF_RE,
// candidatesForToken, listModels) weren't ported either.

type WfStore = z.infer<typeof wfStoreEnum>;

const WORKFLOW_EXT = ".js";
const WF_MARKER = "/.bb/workflows/"; // project workflows live directly under a checkout's .bb/workflows

function joinPath(...parts: string[]): string {
  return parts.join("/").replace(/\/+/g, "/");
}

function baseName(path: string): string {
  const seg = path.split("/").pop() ?? path;
  return seg.endsWith(WORKFLOW_EXT) ? seg.slice(0, -WORKFLOW_EXT.length) : seg;
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

// True when already-normalized `absPath` is `root` itself or sits somewhere under it. Named wfIsWithin
// (not isWithin) to avoid colliding with this file's own pre-existing isWithin(root, target) helper,
// whose argument order is reversed.
function wfIsWithin(absPath: string, root: string): boolean {
  return absPath === root || absPath.startsWith(root.endsWith("/") ? root : root + "/");
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

// Which agents/ directory an agent was discovered in — mirrors rpcContract.wfAgents' output `scope`.
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

// Short readable name for a resolved ref: a SKILL.md's parent directory name (e.g. "foo" for
// ".../skills/foo/SKILL.md"), else the file's own basename. Not used by any transferred wf*
// procedure today (agentRefs stayed behind in workflow-composer) — kept + tested because it is
// small, self-contained, and paired 1:1 with agentRefs should that procedure be ported later.
export function agentRefLabel(absPath: string): string {
  const segs = absPath.split("/");
  const filename = segs[segs.length - 1] ?? absPath;
  if (filename === "SKILL.md" && segs.length >= 2) return segs[segs.length - 2];
  return filename;
}

// --- resolving an area into a set of paths ------------------------------

const GLOBAL_ID = "global";

interface Area {
  kind: "global" | "project";
  label: string;
  /** Host where the project's files live (local for the global area). */
  hostId: string | undefined;
  /** File the panel edits. */
  editedPath: string;
  /** Levels from broad to narrow, for collapsing the effective value. */
  levelPaths: string[];
  installedPath: string;
  personalSkillsDir: string;
  projectSkillsDir: string | null;
  personalAgentsDir: string;
  projectAgentsDir: string | null;
  /** `~/.claude` directory — for global memory and auto-memory. */
  claudeHome: string;
  /** Project root (for project memory), or null in the global area. */
  projectRoot: string | null;
  /** `~/.claude.json` — user- and local-scope MCP servers (local host). */
  claudeJsonPath: string;
  /** `<project root>/.mcp.json` — project connectors; null in the global area. */
  mcpJsonPath: string | null;
}

/**
 * The personal level (`~/.claude`) is resolved against the server's home
 * directory, i.e. the local host. For a project on a remote host this is an
 * approximation: project files are read on its host, but the user level is
 * local. The common case (project on this same machine) is exact.
 */
function resolveArea(
  bb: BbPluginApi,
  areaId: string,
): Promise<Area | null> {
  const home = homedir();
  const claudeHome = join(home, ".claude");
  const claudeJsonPath = join(home, ".claude.json");
  const userSettings = join(home, ".claude", "settings.json");
  const installedPath = join(
    home,
    ".claude",
    "plugins",
    "installed_plugins.json",
  );
  const personalSkillsDir = join(home, ".claude", "skills");
  const personalAgentsDir = join(home, ".claude", "agents");

  if (areaId === GLOBAL_ID) {
    return Promise.resolve({
      kind: "global",
      label: "Globally",
      hostId: undefined,
      editedPath: userSettings,
      levelPaths: [userSettings],
      installedPath,
      personalSkillsDir,
      projectSkillsDir: null,
      personalAgentsDir,
      projectAgentsDir: null,
      claudeHome,
      projectRoot: null,
      claudeJsonPath,
      mcpJsonPath: null,
    });
  }

  return bb.sdk.projects.list().then((projects) => {
    const project = projects.find((candidate) => candidate.id === areaId);
    if (!project) return null;
    const source =
      project.sources.find((entry) => entry.isDefault) ?? project.sources[0];
    if (!source) return null;

    const projectClaude = join(source.path, ".claude");
    const projectSettings = join(projectClaude, "settings.json");
    const localSettings = join(projectClaude, "settings.local.json");
    return {
      kind: "project",
      label: project.name,
      hostId: source.hostId,
      editedPath: localSettings,
      levelPaths: [userSettings, projectSettings, localSettings],
      installedPath,
      personalSkillsDir,
      projectSkillsDir: join(projectClaude, "skills"),
      personalAgentsDir,
      projectAgentsDir: join(projectClaude, "agents"),
      claudeHome,
      projectRoot: source.path,
      claudeJsonPath,
      mcpJsonPath: join(source.path, ".mcp.json"),
    };
  });
}

/**
 * Expands a leading `~` into the host's home directory. Needed for
 * navigating Claude imports like `@~/.claude/skills/x.md`: a click yields a
 * path with `~`, but area bounds checking and reading require an absolute
 * path. Like `resolveArea`, uses the server's (local host's) homedir() —
 * exact for `~/.claude`.
 */
function expandTilde(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

/**
 * Expands a file path from a hook command into an absolute one: Claude Code
 * placeholders (`$CLAUDE_PROJECT_DIR`, `$CLAUDE_CONFIG_DIR`), `$HOME`, `~`,
 * and a relative path (from the project root — that's what Claude Code runs
 * the hook with). Returns null if a placeholder can't be resolved (no
 * project root, an unfamiliar variable): a file can only be shown within the
 * area's bounds.
 */
function expandHookFilePath(raw: string, area: Area): string | null {
  let path = raw
    .replace(/\$\{?CLAUDE_CONFIG_DIR\}?/g, area.claudeHome)
    .replace(/\$\{?CLAUDE_PROJECT_DIR\}?/g, area.projectRoot ?? "\0")
    .replace(/\$\{?HOME\}?/g, homedir());
  if (path.includes("\0")) return null; // needs a project root, and there isn't one
  path = expandTilde(path);
  if (path.startsWith("$")) return null; // an unfamiliar variable remains
  if (!path.startsWith("/")) {
    if (!area.projectRoot) return null;
    path = join(area.projectRoot, path);
  }
  return path;
}

/** Hook as JSON, the way it sits in `settings.json` — for showing the definition. */
function hookDefinitionJson(hook: sd.HookEntry): string {
  const group = {
    ...(hook.matcher ? { matcher: hook.matcher } : {}),
    hooks: [{ type: "command", command: hook.command }],
  };
  return JSON.stringify({ [hook.event]: [group] }, null, 2);
}

/** Whether path `target` sits inside directory `root` (or equals it). */
function isWithin(root: string, target: string): boolean {
  if (target === root) return true;
  return target.startsWith(root.endsWith("/") ? root : `${root}/`);
}

/**
 * The area root the path sits under (and the host for reading/writing), or
 * null. Bounds are `~/.claude` (personal — skills, plugins, auto-memory) and
 * the project root.
 */
function matchRoot(
  area: Area,
  path: string,
): { root: string; hostId: string | undefined } | null {
  const roots: { root: string; hostId: string | undefined }[] = [
    { root: area.claudeHome, hostId: undefined },
  ];
  if (area.projectRoot) {
    roots.push({ root: area.projectRoot, hostId: area.hostId });
  }
  return roots.find((entry) => isWithin(entry.root, path)) ?? null;
}

/** kv-store key for a settings file's disabled hooks, keyed by its path. */
function disabledHooksKey(path: string): string {
  return `disabledHooks:${path}`;
}

/** Hook identity for the toggle/kv: event, matcher, and command all match. */
function sameHook(a: sd.HookEntry, b: sd.HookEntry): boolean {
  return (
    a.event === b.event &&
    (a.matcher ?? null) === (b.matcher ?? null) &&
    a.command === b.command
  );
}

/**
 * Label for a file found via an @-import. Usually the path's last segment,
 * but for `SKILL.md` it's "<skill>/SKILL.md" (otherwise imports from
 * different skills would collapse into the same "SKILL.md" label).
 */
function labelForImport(path: string): string {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  const last = segments[segments.length - 1] ?? path;
  if (last === "SKILL.md" && segments.length >= 2) {
    return `${segments[segments.length - 2]}/SKILL.md`;
  }
  return last;
}

/**
 * Skill name from the path to its `SKILL.md`, relative to the skills
 * directory — the same shape as `collectSkillNames` in `src/catalog.ts` (see
 * its comment about `synced/`). `null` if the path doesn't lead directly to
 * a `SKILL.md` inside a skill.
 */
function skillTargetName(relPath: string): string | null {
  const segments = relPath.split("/").filter((segment) => segment.length > 0);
  if (segments[segments.length - 1] !== "SKILL.md") return null;
  if (segments[0] === "synced" && segments.length === 3) return segments[1];
  if (segments.length === 2) return segments[0];
  return null;
}

/** Memory file: id is stable for RPC, the server resolves the path and host. */
interface MemoryEntry {
  id: string;
  label: string;
  path: string;
  hostId: string | undefined;
}

/**
 * Memory file candidates for the area (without checking existence). The
 * global CLAUDE.md and auto-memory live on the local host; project files —
 * on the project's host. Auto-memory is Claude Code's per-project directory:
 * the path is encoded by replacing `/` with `-` (that's how Claude Code
 * itself names them).
 */
function memoryCandidates(area: Area): MemoryEntry[] {
  const list: MemoryEntry[] = [
    {
      id: "global-claude",
      label: "Global CLAUDE.md",
      path: join(area.claudeHome, "CLAUDE.md"),
      hostId: undefined,
    },
  ];
  if (area.kind === "project" && area.projectRoot) {
    const root = area.projectRoot;
    const enc = root.replace(/\//g, "-");
    list.push(
      { id: "project-claude", label: "Project CLAUDE.md", path: join(root, "CLAUDE.md"), hostId: area.hostId },
      { id: "project-claude-local", label: "CLAUDE.local.md", path: join(root, "CLAUDE.local.md"), hostId: area.hostId },
      { id: "project-agents", label: "AGENTS.md", path: join(root, "AGENTS.md"), hostId: area.hostId },
      { id: "project-memory", label: "memory/MEMORY.md", path: join(root, "memory", "MEMORY.md"), hostId: area.hostId },
      { id: "project-memory-index", label: "memory/INDEX.md", path: join(root, "memory", "INDEX.md"), hostId: area.hostId },
      { id: "auto-memory", label: "Auto-memory MEMORY.md", path: join(area.claudeHome, "projects", enc, "memory", "MEMORY.md"), hostId: undefined },
    );
  }
  return list;
}

// Settings section as a leveled field: reading/writing its "own" value and
// collapsing levels. `default` — the default value, which isn't stored in
// the file (for plugins, "off"; for skills, "fully"). Lets plugins and
// skills be written with one shared helper.
interface LeveledSection<S extends string> {
  default: S;
  get(document: sd.SettingsDoc, key: string): S;
  set(document: sd.SettingsDoc, key: string, own: S): sd.SettingsDoc;
  resolve(levels: S[]): string;
}

const PLUGIN_SECTION: LeveledSection<sd.PluginToggle> = {
  default: "off",
  get: sd.getPlugin,
  set: sd.setPlugin,
  resolve: resolvePlugin,
};

const SKILL_SECTION: LeveledSection<sd.SkillState> = {
  default: "on",
  get: sd.getSkill,
  set: sd.setSkill,
  resolve: resolveSkill,
};

// Tool search loading — a single field (the env key is fixed), so `key` is
// ignored. Default is auto: an unset variable behaves that way already.
const TOOLSEARCH_SECTION: LeveledSection<sd.ToolSearchMode> = {
  default: "auto",
  get: (document) => sd.getToolSearch(document),
  set: (document, _key, own) => sd.setToolSearch(document, own),
  resolve: resolveToolSearch,
};

export default function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  // What to open a real file with (skill, agent, document, link, hook file)
  // — one setting for the whole plugin, read live by the front end via
  // useSettings.
  //   md-opener — in the embedded column, with the Kasimov editor (MdDocView);
  //   builtin    — in the embedded column, with the stock MarkdownEditor + field table;
  //   host       — delegate to bb's host tab (previous behavior, def088e).
  // Supersedes decision claude-config-delegate-file-open: a choice instead of
  // a hardcode (memory/decisions/claude-config-opener-setting.md).
  // Kasimov settings (font size/spacing/colors/fonts + flags) are declared as
  // a single table in src/kasimov-settings; here we just mix them into the
  // plugin's settings alongside fileOpener. The front end reads them live via
  // useSettings and applies them to the editor column (ColumnMdDocView).
  //
  // Default presets are "to match the native bb viewer", the same as MD
  // Opener: both render Kasimov through the same MdDocView/md-doc-view.css
  // (used to be hardcoded there, see
  // memory/decisions/kasimov-opener-css-uses-token-defaults.md) — the owner
  // explicitly asked for both consumers to look the same.
  // (doc-editor.css in this plugin is about a different editor,
  // packages/md-editor with the cc-doc-mde class; it has nothing to do with
  // Kasimov.)
  bb.settings.define({
    fileOpener: {
      type: "select",
      label: "What to open files with",
      options: ["md-opener", "builtin", "host"],
      default: "md-opener",
    },
    ...buildDescriptors(NATIVE_VIEWER_TOKEN_DEFAULTS),
  });

  // Reading a file: absence is an empty document (text=null), not an error.
  // sha is needed for a CAS write; if the file is absent, the write proceeds
  // as create-only.
  async function readFile(
    path: string,
    hostId: string | undefined,
    rootPath?: string,
  ): Promise<{ text: string | null; sha256: string | null }> {
    try {
      const file = await bb.sdk.files.read({ path, hostId, rootPath });
      const text =
        file.contentEncoding === "base64"
          ? Buffer.from(file.content, "base64").toString("utf8")
          : file.content;
      return { text, sha256: file.sha256 };
    } catch {
      return { text: null, sha256: null };
    }
  }

  // Paths of files inside a directory (relative to it): skills and agents directories.
  async function listDirFiles(
    dir: string | null,
    hostId: string | undefined,
  ): Promise<string[]> {
    if (!dir) return [];
    try {
      const result = await bb.sdk.files.listPaths({
        path: dir,
        hostId,
        includeFiles: true,
        includeDirectories: false,
        limit: 5000,
      });
      return result.paths.map((entry) => entry.path);
    } catch {
      return [];
    }
  }

  /** Hooks toggled off for a settings file, keyed by its path (or []). */
  async function readDisabledHooks(path: string): Promise<sd.HookEntry[]> {
    return (await bb.storage.kv.get<sd.HookEntry[]>(disabledHooksKey(path))) ?? [];
  }

  /** Reads and parses a settings file; turns SettingsParseError into a message. */
  async function readParsedDoc(
    path: string,
    hostId: string | undefined,
  ): Promise<{ doc: sd.SettingsDoc; sha256: string | null } | { error: string }> {
    const { text, sha256 } = await readFile(path, hostId);
    try {
      return { doc: sd.parse(text), sha256 };
    } catch (error) {
      if (error instanceof SettingsParseError) return { error: error.message };
      throw error;
    }
  }

  /**
   * Like editing the area's edited file (see `applyEdit` below), but for an
   * arbitrary level's file: a hook may live outside `editedPath`. A fresh
   * read right before the write gives the same CAS protection against a
   * concurrent Claude Code session.
   */
  async function applyEditToPath(
    path: string,
    hostId: string | undefined,
    edit: (doc: sd.SettingsDoc) => sd.SettingsDoc,
  ): Promise<{ outcome: "ok" | "conflict" | "parse-error"; message: string | null }> {
    const parsed = await readParsedDoc(path, hostId);
    if ("error" in parsed) return { outcome: "parse-error", message: parsed.error };

    const next = sd.serialize(edit(parsed.doc));
    const written = await bb.sdk.files.write({
      path,
      hostId,
      content: next,
      expectedSha256: parsed.sha256 ?? null,
      createParents: true,
    });
    if (written.outcome === "conflict") {
      return {
        outcome: "conflict",
        message: "Another session changed the file. Refresh and try again.",
      };
    }
    return { outcome: "ok", message: null };
  }

  // --- workflow builder: state and handlers (port) ------------------------
  // Inline instead of the original plugin's createPlugin/WorkflowDeps
  // factory: this server doesn't need an injection factory (tests target the
  // pure functions above), and the handlers themselves are registered in the
  // shared `bb.rpc.register` below.

  const wfHome = homedir();
  const wfGlobalDir = joinPath(wfHome, ".claude", "workflows");
  const wfBbBin = resolveBbBin();

  function runBbCli(args: string[], opts?: { cwd?: string }): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolvePromise) => {
      const child = spawn(wfBbBin, args, { cwd: opts?.cwd, env: process.env });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));
      child.on("error", (err) => resolvePromise({ code: -1, stdout, stderr: stderr + String(err) }));
      child.on("close", (code) => resolvePromise({ code: code ?? -1, stdout, stderr }));
    });
  }

  function gitWorktrees(root: string): Promise<string[]> {
    return new Promise((resolvePromise) => {
      const child = spawn("git", ["-C", root, "worktree", "list", "--porcelain"], { env: process.env });
      let out = "";
      child.stdout.on("data", (d) => (out += d.toString()));
      child.on("error", () => resolvePromise([]));
      child.on("close", () =>
        resolvePromise(
          out
            .split("\n")
            .filter((l) => l.startsWith("worktree "))
            .map((l) => l.slice("worktree ".length).trim())
            .filter(Boolean),
        ),
      );
    });
  }

  // The project's default source (checkout root + its host).
  async function projectSource(projectId: string | null): Promise<{ hostId: string; path: string }> {
    if (!projectId) throw new Error("project store needs a project in view");
    const project = await bb.sdk.projects.get({ projectId });
    const source = project.sources.find((s) => s.isDefault) ?? project.sources[0];
    if (!source) throw new Error("project has no source path");
    return { hostId: source.hostId, path: source.path };
  }

  // Scan one directory for top-level workflow .js files, reading each to recover its description/tree.
  async function wfScanDir(hostId: string | undefined, dir: string, store: WfStore) {
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
        const tree = parseWorkflow(file.content);
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
  async function wfListProjectStore(projectId: string | null) {
    let src: { hostId: string; path: string };
    try {
      src = await projectSource(projectId);
    } catch {
      return [];
    }
    const worktrees = await gitWorktrees(src.path).catch(() => []);
    const roots = [...new Set([src.path, ...worktrees])];
    const byName = new Map<string, Awaited<ReturnType<typeof wfScanDir>>[number]>();
    for (const root of roots) {
      for (const item of await wfScanDir(src.hostId, joinPath(root, ".bb", "workflows"), "project")) {
        if (!byName.has(item.name)) byName.set(item.name, item);
      }
    }
    return [...byName.values()];
  }

  // hostId + working dir for an already-existing file (read/remove/validate/run).
  async function wfResolveFile(store: WfStore, projectId: string | null, path: string): Promise<{ hostId: string | undefined; cwd: string | undefined }> {
    if (store === "global") {
      assertGlobalPath(wfGlobalDir, path);
      return { hostId: undefined, cwd: undefined };
    }
    assertProjectWorkflowPath(path);
    const src = await projectSource(projectId);
    return { hostId: src.hostId, cwd: projectRootOf(path) ?? undefined };
  }

  bb.rpc.register(rpcContract, {
    async listAreas() {
      const projects = await bb.sdk.projects.list();
      return {
        areas: [
          { id: GLOBAL_ID, label: "Globally" },
          ...projects.map((project) => ({
            id: project.id,
            label: project.name,
          })),
        ],
      };
    },

    async getConfig({ areaId }) {
      const area = await resolveArea(bb, areaId);
      if (!area) {
        return emptyConfig("—", "", {
          file: "",
          message: "Area not found.",
        });
      }

      // Parse each level tied to its file: corrupt JSON becomes a UI
      // message, not a swap-in empty document (otherwise the first write
      // would clobber the file).
      const parsedLevels: sd.SettingsDoc[] = [];
      for (const path of area.levelPaths) {
        const { text } = await readFile(path, area.hostId);
        try {
          parsedLevels.push(sd.parse(text));
        } catch (error) {
          if (error instanceof SettingsParseError) {
            return emptyConfig(area.label, area.editedPath, {
              file: path,
              message: error.message,
            });
          }
          throw error;
        }
      }
      // The edited file is the last of the levels (local or global).
      const editedDoc = parsedLevels[parsedLevels.length - 1] ?? {};

      const installed = await readFile(area.installedPath, area.hostId);
      // .mcp.json — on the project's host; ~/.claude.json — on the local host.
      const mcpJson = area.mcpJsonPath
        ? await readFile(area.mcpJsonPath, area.hostId)
        : { text: null, sha256: null };
      const claudeJson = await readFile(area.claudeJsonPath, undefined);
      const [
        personalSkillPaths,
        projectSkillPaths,
        personalAgentPaths,
        projectAgentPaths,
      ] = await Promise.all([
        listDirFiles(area.personalSkillsDir, area.hostId),
        listDirFiles(area.projectSkillsDir, area.hostId),
        listDirFiles(area.personalAgentsDir, area.hostId),
        listDirFiles(area.projectAgentsDir, area.hostId),
      ]);
      // Keyed by the level file's PATH, not by area: ~/.claude/settings.json
      // is shared across all project areas, and the disabled hooks in it
      // must be shared too.
      const disabledHooksByLevel = await Promise.all(
        area.levelPaths.map((path) => readDisabledHooks(path)),
      );

      // Level origins: one (user) globally, three in order for a project.
      const levelOrigins =
        area.kind === "global"
          ? (["user"] as const)
          : (["user", "project", "local"] as const);

      const view = buildConfigView({
        areaKind: area.kind,
        editedDoc,
        levelDocs: parsedLevels,
        installedPluginsText: installed.text,
        personalSkillPaths,
        projectSkillPaths,
        personalAgentDir: area.personalAgentsDir,
        projectAgentDir: area.projectAgentsDir,
        personalAgentPaths,
        projectAgentPaths,
        mcpJsonText: mcpJson.text,
        claudeJsonText: claudeJson.text,
        projectRoot: area.projectRoot,
        levelOrigins: [...levelOrigins],
        disabledHooksByLevel,
      });

      // Row "weight" in tokens: read the section's file contents and
      // estimate. A read error means tokens=null (the UI label just shows
      // no weight).
      const tokensOf = async (
        path: string | null,
        hostId: string | undefined,
        rootPath?: string,
      ): Promise<number | null> => {
        if (!path) return null;
        const { text } = await readFile(path, hostId, rootPath);
        return text == null ? null : estimateTokens(text);
      };

      // Skill name -> path to its SKILL.md (same layout as collectSkillNames).
      const skillFileByName = (
        dir: string | null,
        relPaths: string[],
      ): Map<string, string> => {
        const map = new Map<string, string>();
        if (!dir) return map;
        for (const rel of relPaths) {
          const seg = rel.split("/").filter(Boolean);
          if (seg[seg.length - 1] !== "SKILL.md") continue;
          const name =
            seg[0] === "synced" && seg.length === 3
              ? seg[1]
              : seg.length === 2
                ? seg[0]
                : null;
          if (name) map.set(name, join(dir, rel));
        }
        return map;
      };
      const personalSkillFiles = skillFileByName(
        area.personalSkillsDir,
        personalSkillPaths,
      );
      const projectSkillFiles = skillFileByName(
        area.projectSkillsDir,
        projectSkillPaths,
      );

      // Connector definitions (JSON) keyed by origin:name — their weight.
      const connectorDefs = new Map<string, string>();
      for (const server of parseMcpJson(mcpJson.text)) {
        connectorDefs.set(
          `mcpjson:${server.name}`,
          JSON.stringify(server.config),
        );
      }
      const claudeServers = parseClaudeJsonServers(
        claudeJson.text,
        area.projectRoot,
      );
      for (const server of claudeServers.user) {
        connectorDefs.set(`user:${server.name}`, JSON.stringify(server.config));
      }
      for (const server of claudeServers.local) {
        connectorDefs.set(`local:${server.name}`, JSON.stringify(server.config));
      }

      const [skills, agents, plugins] = await Promise.all([
        Promise.all(
          view.skills.map(async (skill) => {
            const path = (
              skill.origin === "project" ? projectSkillFiles : personalSkillFiles
            ).get(skill.name);
            return {
              ...skill,
              path: path ?? null,
              tokens: await tokensOf(path ?? null, area.hostId),
            };
          }),
        ),
        Promise.all(
          view.agents.map(async (agent) => ({
            ...agent,
            tokens: await tokensOf(agent.path, area.hostId),
          })),
        ),
        Promise.all(
          view.plugins.map(async (plugin) => {
            if (!plugin.installPath) return { ...plugin, tokens: null };
            const manifest = await readFile(
              join(plugin.installPath, ".claude-plugin", "plugin.json"),
              area.hostId,
              area.claudeHome,
            );
            let readme = "";
            for (const name of ["README.md", "readme.md"]) {
              const { text } = await readFile(
                join(plugin.installPath, name),
                area.hostId,
                area.claudeHome,
              );
              if (text != null) {
                readme = text;
                break;
              }
            }
            const combined = (manifest.text ?? "") + readme;
            return {
              ...plugin,
              tokens: combined.length ? estimateTokens(combined) : null,
            };
          }),
        ),
      ]);
      const connectors = view.connectors.map((connector) => {
        const def = connectorDefs.get(`${connector.origin}:${connector.name}`);
        return { ...connector, tokens: def ? estimateTokens(def) : null };
      });

      return {
        areaLabel: area.label,
        editedFilePath: area.editedPath,
        error: null,
        ...view,
        plugins,
        connectors,
        skills,
        agents,
      };
    },

    setPlugin({ areaId, key, value }) {
      return writeLeveled(areaId, key, PLUGIN_SECTION, value ? "on" : "off");
    },

    setConnector({ areaId, name, value }) {
      return writeConnector(areaId, name, value);
    },

    setSkill({ areaId, name, state }) {
      return writeLeveled(areaId, name, SKILL_SECTION, state);
    },

    setToolSearch({ areaId, mode }) {
      return writeLeveled(areaId, "", TOOLSEARCH_SECTION, mode);
    },

    async readConnector({ areaId, name, origin }) {
      const notFound = {
        path: "",
        content: null,
        error: "Connector not found.",
        sha256: null,
      };
      const area = await resolveArea(bb, areaId);
      if (!area) {
        return { path: "", content: null, error: "Area not found.", sha256: null };
      }

      let config: unknown;
      let path: string;
      if (origin === "mcpjson") {
        if (!area.mcpJsonPath) return notFound;
        const { text } = await readFile(area.mcpJsonPath, area.hostId);
        config = parseMcpJson(text).find((server) => server.name === name)?.config;
        path = area.mcpJsonPath;
      } else {
        // user/local — from ~/.claude.json on the local host.
        const { text } = await readFile(area.claudeJsonPath, undefined);
        const { user, local } = parseClaudeJsonServers(text, area.projectRoot);
        const list = origin === "user" ? user : local;
        config = list.find((server) => server.name === name)?.config;
        path = area.claudeJsonPath;
      }

      if (config === undefined) return notFound;
      return {
        path,
        content: JSON.stringify(config, null, 2),
        error: null,
        sha256: null,
      };
    },

    async readHook({ areaId, origin, index }) {
      const notFound = {
        path: "",
        command: null,
        error: "Hook not found.",
        sha256: null,
        event: null,
        matcher: null,
        definition: null,
        filePath: null,
        fileContent: null,
        fileSha256: null,
      };
      const area = await resolveArea(bb, areaId);
      if (!area) {
        return { ...notFound, error: "Area not found." };
      }
      // origin -> level: user/project/local correspond to levelPaths order.
      const levelIndex = { user: 0, project: 1, local: 2 }[origin];
      const path = area.levelPaths[levelIndex];
      if (!path) return notFound;

      const { text, sha256 } = await readFile(path, area.hostId);
      let hook;
      try {
        hook = sd.listHooks(sd.parse(text))[index];
      } catch (error) {
        if (error instanceof SettingsParseError) {
          return { ...notFound, path, error: error.message };
        }
        throw error;
      }
      if (!hook) return { ...notFound, path };

      // The file the command reads or runs (if recognized and within the
      // area's bounds): expand environment placeholders, read with confinement.
      let filePath: string | null = null;
      let fileContent: string | null = null;
      let fileSha256: string | null = null;
      const rawFile = extractCommandFile(hook.command);
      if (rawFile) {
        const abs = expandHookFilePath(rawFile, area);
        const match = abs && matchRoot(area, abs);
        if (abs && match) {
          const { text: fileText, sha256: fileSha } = await readFile(
            abs,
            match.hostId,
            match.root,
          );
          if (fileText !== null) {
            filePath = abs;
            fileContent = fileText;
            fileSha256 = fileSha;
          }
        }
      }

      return {
        path,
        command: hook.command,
        error: null,
        sha256,
        event: hook.event,
        matcher: hook.matcher,
        definition: hookDefinitionJson(hook),
        filePath,
        fileContent,
        fileSha256,
      };
    },

    async writeHook({ areaId, origin, index, command, expectedSha256 }) {
      const area = await resolveArea(bb, areaId);
      if (!area) {
        return { outcome: "not-found" as const, sha256: null, message: "Area not found." };
      }
      const levelIndex = { user: 0, project: 1, local: 2 }[origin];
      const path = area.levelPaths[levelIndex];
      if (!path) {
        return { outcome: "not-found" as const, sha256: null, message: "Level not found." };
      }

      const parsed = await readParsedDoc(path, area.hostId);
      if ("error" in parsed) {
        return { outcome: "denied" as const, sha256: null, message: parsed.error };
      }

      // index out of range — nothing to write: don't report "written" for a no-op.
      if (!sd.listHooks(parsed.doc)[index]) {
        return { outcome: "not-found" as const, sha256: null, message: "Hook not found." };
      }

      const next = sd.setHookCommandAt(parsed.doc, index, command);
      const written = await bb.sdk.files.write({
        path,
        hostId: area.hostId,
        content: sd.serialize(next),
        expectedSha256,
        createParents: true,
      });
      if (written.outcome === "conflict") {
        return {
          outcome: "conflict" as const,
          sha256: written.currentSha256,
          message: "The file changed on disk. Refresh and try again.",
        };
      }
      return { outcome: "written" as const, sha256: written.sha256, message: null };
    },

    async writeHookDefinition({ areaId, origin, index, definition, expectedSha256 }) {
      const area = await resolveArea(bb, areaId);
      if (!area) {
        return { outcome: "not-found" as const, sha256: null, message: "Area not found." };
      }
      const levelIndex = { user: 0, project: 1, local: 2 }[origin];
      const path = area.levelPaths[levelIndex];
      if (!path) {
        return { outcome: "not-found" as const, sha256: null, message: "Level not found." };
      }

      const parsed = await readParsedDoc(path, area.hostId);
      if ("error" in parsed) {
        return { outcome: "denied" as const, sha256: null, message: parsed.error };
      }

      const oldEntry = sd.listHooks(parsed.doc)[index];
      if (!oldEntry) {
        return { outcome: "not-found" as const, sha256: null, message: "Hook not found." };
      }

      let newEntry: sd.HookEntry;
      try {
        newEntry = sd.parseHookDefinitionJson(definition);
      } catch (error) {
        if (error instanceof HookDefinitionParseError) {
          return { outcome: "denied" as const, sha256: null, message: error.message };
        }
        throw error;
      }

      const { doc: next, replaced } = sd.replaceHook(parsed.doc, oldEntry, newEntry);
      if (!replaced) {
        return { outcome: "not-found" as const, sha256: null, message: "Hook not found." };
      }
      const written = await bb.sdk.files.write({
        path,
        hostId: area.hostId,
        content: sd.serialize(next),
        expectedSha256,
        createParents: true,
      });
      if (written.outcome === "conflict") {
        return {
          outcome: "conflict" as const,
          sha256: written.currentSha256,
          message: "The file changed on disk. Refresh and try again.",
        };
      }
      return { outcome: "written" as const, sha256: written.sha256, message: null };
    },

    async setHookEnabled({
      areaId,
      origin,
      event,
      matcher,
      command,
      enabled,
    }): Promise<WriteOutcome> {
      const area = await resolveArea(bb, areaId);
      if (!area) return { outcome: "not-found", message: "Area not found." };
      const levelIndex = { user: 0, project: 1, local: 2 }[origin];
      const path = area.levelPaths[levelIndex];
      if (!path) return { outcome: "not-found", message: "Level not found." };

      const entry: sd.HookEntry = { event, matcher, command };

      if (!enabled) {
        const parsed = await readParsedDoc(path, area.hostId);
        if ("error" in parsed) return { outcome: "parse-error", message: parsed.error };

        const { doc: next, removed } = sd.removeHook(parsed.doc, entry);
        // Already disabled (or not in the file at all) — idempotent, don't touch kv.
        if (removed === null) return { outcome: "ok", message: null };

        const written = await bb.sdk.files.write({
          path,
          hostId: area.hostId,
          content: sd.serialize(next),
          expectedSha256: parsed.sha256 ?? null,
          createParents: true,
        });
        if (written.outcome === "conflict") {
          return {
            outcome: "conflict",
            message: "Another session changed the file. Refresh and try again.",
          };
        }

        const disabled = await readDisabledHooks(path);
        if (!disabled.some((existing) => sameHook(existing, entry))) {
          await bb.storage.kv.set(disabledHooksKey(path), [...disabled, entry]);
        }
        return { outcome: "ok", message: null };
      }

      const disabled = await readDisabledHooks(path);
      if (!disabled.some((existing) => sameHook(existing, entry))) {
        // Nothing to restore — idempotent.
        return { outcome: "ok", message: null };
      }

      const written = await applyEditToPath(path, area.hostId, (doc) =>
        sd.addHook(doc, entry),
      );
      if (written.outcome !== "ok") return written;

      const remaining = disabled.filter((existing) => !sameHook(existing, entry));
      if (remaining.length === 0) await bb.storage.kv.delete(disabledHooksKey(path));
      else await bb.storage.kv.set(disabledHooksKey(path), remaining);
      return { outcome: "ok", message: null };
    },

    async readSkillFile({ areaId, name, relPath }) {
      const area = await resolveArea(bb, areaId);
      if (!area) {
        return { path: "", content: null, error: "Area not found.", sha256: null };
      }

      // Links inside a skill are resolved relative to its SKILL.md's folder,
      // but read with confinement to the `.claude` root — so the standard
      // `../../CONNECTORS.md` link to the file shared by all skills gets
      // through, while escaping `.claude` (ssh keys and the like) stays
      // closed off.
      const found = await findSkill(area, name);
      if (!found) {
        return { path: "", content: null, error: "SKILL.md not found.", sha256: null };
      }

      const target = join(found.base, relPath);
      const { text, sha256 } = await readFile(target, area.hostId, found.root);
      if (text === null) {
        return { path: "", content: null, error: "File not found.", sha256: null };
      }
      return { path: target, content: text, error: null, sha256 };
    },

    async listMemory({ areaId }) {
      const area = await resolveArea(bb, areaId);
      if (!area) return { entries: [] };

      const entries: { id: string; label: string; path: string }[] = [];
      const visited = new Set<string>();
      // The queue holds the already-read file text — we parse it for
      // @-imports without reading from disk a second time.
      const queue: { path: string; text: string }[] = [];

      for (const candidate of memoryCandidates(area)) {
        visited.add(candidate.path);
        const { text } = await readFile(candidate.path, candidate.hostId);
        if (text === null) continue;
        entries.push({
          id: candidate.id,
          label: candidate.label,
          path: candidate.path,
        });
        queue.push({ path: candidate.path, text });
      }

      // Resolve @-imports transitively: CLAUDE.md links to skills, skills to
      // their own files. Capped by count, not by depth — a guard against a
      // sprawling link tree, not just against cycles (those are already cut
      // off by `visited`).
      const IMPORT_LIMIT = 100;
      let imported = 0;
      while (queue.length > 0 && imported < IMPORT_LIMIT) {
        const from = queue.shift();
        if (!from) break;

        for (const importPath of parseImports(from.text)) {
          if (imported >= IMPORT_LIMIT) {
            bb.log.info("listMemory: cut off by the import limit (100)");
            break;
          }
          const abs = resolveImportPath(from.path, importPath, homedir());
          if (visited.has(abs)) continue;
          visited.add(abs);

          // Outside the area's roots — skip (same boundary as readDoc).
          const target = matchRoot(area, abs);
          if (!target) continue;

          const { text: importedText } = await readFile(abs, target.hostId, target.root);
          if (importedText === null) continue;

          entries.push({ id: `import:${abs}`, label: labelForImport(abs), path: abs });
          queue.push({ path: abs, text: importedText });
          imported += 1;
        }
      }

      return { entries };
    },

    async listRefTargets({ areaId }) {
      const area = await resolveArea(bb, areaId);
      if (!area) return { targets: [] };

      try {
        const [personalSkillPaths, projectSkillPaths] = await Promise.all([
          listDirFiles(area.personalSkillsDir, area.hostId),
          listDirFiles(area.projectSkillsDir, area.hostId),
        ]);

        const targets: { value: string; label: string; kind: "skill" | "memory" }[] = [];
        const seen = new Set<string>();
        const push = (value: string, label: string, kind: "skill" | "memory") => {
          if (seen.has(value)) return;
          seen.add(value);
          targets.push({ value, label, kind });
        };

        // Personal skills: the path is already relative to
        // `~/.claude/skills`, so the inserted import is just
        // `~/.claude/skills/<this same path>`.
        for (const relPath of personalSkillPaths) {
          const name = skillTargetName(relPath);
          if (!name) continue;
          push(`~/.claude/skills/${relPath}`, name, "skill");
        }
        // Project skills: insert the absolute path (no `~` alias for a project).
        if (area.projectSkillsDir) {
          for (const relPath of projectSkillPaths) {
            const name = skillTargetName(relPath);
            if (!name) continue;
            push(join(area.projectSkillsDir, relPath), name, "skill");
          }
        }

        for (const candidate of memoryCandidates(area)) {
          const { text } = await readFile(candidate.path, candidate.hostId);
          if (text !== null) push(candidate.path, candidate.label, "memory");
        }

        return { targets };
      } catch {
        return { targets: [] };
      }
    },

    async readDoc({ areaId, path }) {
      const area = await resolveArea(bb, areaId);
      if (!area) {
        return { path: "", content: null, error: "Area not found.", sha256: null };
      }
      // Expand `~` (following an @-import yields a path with ~) and return
      // the already-absolute path — the front end resolves nested links from it.
      const abs = expandTilde(path);
      const match = matchRoot(area, abs);
      if (!match) {
        return { path: "", content: null, error: "Path outside the available folders.", sha256: null };
      }
      const { text, sha256 } = await readFile(abs, match.hostId, match.root);
      if (text === null) {
        return { path: "", content: null, error: "File not found.", sha256: null };
      }
      return { path: abs, content: text, error: null, sha256 };
    },

    async resolveOpenTarget({ areaId, path }) {
      const area = await resolveArea(bb, areaId);
      if (!area) return { hostId: null, error: "Area not found." };
      const abs = expandTilde(path);
      const match = matchRoot(area, abs);
      if (!match) return { hostId: null, error: "Path outside the available folders." };
      // A project root carries its own host; the personal level (~/.claude)
      // lives on the server's local host — take its id from primaryHostId.
      if (match.hostId) return { hostId: match.hostId, error: null };
      const { primaryHostId } = await bb.sdk.system.config();
      if (!primaryHostId) {
        return { hostId: null, error: "Primary host not determined." };
      }
      return { hostId: primaryHostId, error: null };
    },

    async listDocPaths({ areaId, path }) {
      const area = await resolveArea(bb, areaId);
      if (!area) return { paths: [] };
      const dir = dirname(expandTilde(path));
      const match = matchRoot(area, dir);
      if (!match) return { paths: [] };
      try {
        const result = await bb.sdk.files.listPaths({
          path: dir,
          hostId: match.hostId,
          includeFiles: true,
          includeDirectories: false,
          limit: 2000,
        });
        const prefix = dir.endsWith("/") ? dir : dir + "/";
        const paths = result.paths
          .map((entry) =>
            entry.path.startsWith(prefix)
              ? entry.path.slice(prefix.length)
              : entry.path,
          )
          .filter(
            (p) =>
              p.length > 0 &&
              !p.startsWith(".git/") &&
              !p.startsWith("node_modules/") &&
              !p.includes("/node_modules/"),
          );
        return { paths };
      } catch {
        return { paths: [] };
      }
    },

    async readPlugin({ areaId, key }) {
      const empty = {
        manifestPath: "",
        manifest: null,
        readmePath: null,
        readme: null,
      };
      const area = await resolveArea(bb, areaId);
      if (!area) return { ...empty, error: "Area not found." };

      // installPath comes from installed_plugins.json (it's on the local host).
      const installed = await readFile(area.installedPath, undefined);
      const plugin = parseInstalledPlugins(installed.text).find(
        (entry) => entry.key === key,
      );
      if (!plugin?.installPath) return { ...empty, error: "Plugin not found." };

      const base = plugin.installPath;
      const manifestPath = join(base, ".claude-plugin", "plugin.json");
      const manifest = await readFile(manifestPath, undefined, area.claudeHome);

      // README is optional: some plugins don't have one — then readme = null.
      let readmePath: string | null = null;
      let readme: string | null = null;
      for (const name of ["README.md", "readme.md"]) {
        const candidate = join(base, name);
        const { text } = await readFile(candidate, undefined, area.claudeHome);
        if (text !== null) {
          readmePath = candidate;
          readme = text;
          break;
        }
      }
      return {
        manifestPath,
        manifest: manifest.text,
        readmePath,
        readme,
        error: manifest.text === null ? "Manifest not found." : null,
      };
    },

    async writeDoc({ areaId, path, content, expectedSha256 }) {
      const area = await resolveArea(bb, areaId);
      if (!area) {
        return { outcome: "not-found" as const, sha256: null, message: "Area not found." };
      }
      const match = matchRoot(area, path);
      if (!match) {
        return { outcome: "denied" as const, sha256: null, message: "Path outside the available folders." };
      }
      const written = await bb.sdk.files.write({
        path,
        hostId: match.hostId,
        rootPath: match.root,
        content,
        expectedSha256,
      });
      if (written.outcome === "conflict") {
        return {
          outcome: "conflict" as const,
          sha256: written.currentSha256,
          message: "The file changed on disk. Refresh and try again.",
        };
      }
      return { outcome: "written" as const, sha256: written.sha256, message: null };
    },

    createSkill({ areaId, name }) {
      // A skill is a `<slug>/SKILL.md` folder; in a project it goes into the
      // project directory, globally into the personal one. The directory is
      // created along with the file (createParents).
      return createFile(areaId, name, (area, slug) => {
        const dir = area.projectSkillsDir ?? area.personalSkillsDir;
        return { path: join(dir, slug, "SKILL.md"), content: skillTemplate(slug) };
      });
    },

    createAgent({ areaId, name }) {
      // An agent is a single `<slug>.md` file in the area's agents directory.
      return createFile(areaId, name, (area, slug) => {
        const dir = area.projectAgentsDir ?? area.personalAgentsDir;
        return { path: join(dir, `${slug}.md`), content: agentTemplate(slug) };
      });
    },

    // ---- workflow builder (port of bb-plugin-workflow-composer) ----

    async wfList({ projectId }) {
      const [project, global] = await Promise.all([wfListProjectStore(projectId), wfScanDir(undefined, wfGlobalDir, "global")]);
      return { items: [...project, ...global] };
    },

    async wfRead({ projectId, store, path }) {
      const { hostId } = await wfResolveFile(store, projectId, path);
      const file = await bb.sdk.files.read({ hostId, path });
      return { source: file.content, tree: parseWorkflow(file.content) };
    },

    async wfSave({ projectId, store, name, source }) {
      const slug = String(name).trim();
      if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error("name must be lowercase kebab-case");
      let hostId: string | undefined;
      let dir: string;
      if (store === "global") {
        hostId = undefined;
        dir = wfGlobalDir;
      } else {
        const src = await projectSource(projectId);
        hostId = src.hostId;
        dir = joinPath(src.path, ".bb", "workflows"); // new project workflows land in the default checkout
      }
      const path = joinPath(dir, slug + WORKFLOW_EXT);
      await bb.sdk.files.write({ hostId, path, content: source, createParents: true });
      return { path };
    },

    async wfRemove({ projectId, store, path }) {
      const { hostId } = await wfResolveFile(store, projectId, path);
      await bb.sdk.files.remove({ hostId, path });
      return { ok: true };
    },

    async wfValidate({ projectId, store, path }) {
      const { cwd } = await wfResolveFile(store, projectId, path);
      const res = await runBbCli(["workflows", "validate", "--file", path], { cwd });
      return { ok: res.code === 0, output: (res.stdout + res.stderr).trim() };
    },

    async wfRun({ projectId, store, path }) {
      const { cwd } = await wfResolveFile(store, projectId, path);
      const res = await runBbCli(["workflows", "run", "--file", path], { cwd });
      return { ok: res.code === 0, runId: extractRunId(res.stdout + res.stderr), output: (res.stdout + res.stderr).trim() };
    },

    async wfStatus({ runId }) {
      const res = await runBbCli(["workflows", "status", runId]);
      return { output: (res.stdout + res.stderr).trim() };
    },

    async wfProjects() {
      const list = await bb.sdk.projects.list();
      return list.map((p) => ({ id: p.id, name: p.name }));
    },

    async wfAgents({ projectId }) {
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

      const userDir = joinPath(wfHome, ".claude", "agents");
      const userPaths = await listPathsSafe(bb, { path: userDir });
      for (const name of bareAgentNames(userPaths)) await addAgent(name, undefined, joinPath(userDir, name + ".md"), "user");

      if (projectId !== null) {
        try {
          const src = await projectSource(projectId);
          const projectDir = joinPath(src.path, ".claude", "agents");
          const projectPaths = await listPathsSafe(bb, { hostId: src.hostId, path: projectDir });
          for (const name of bareAgentNames(projectPaths))
            await addAgent(name, src.hostId, joinPath(projectDir, name + ".md"), "project");
        } catch {
          // no resolvable project source → project agents skipped
        }
      }

      const pluginsDir = joinPath(wfHome, ".claude", "plugins");
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

    async wfProviderCatalog() {
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

    async wfWriteAgent({ projectId, scope, name, content, overwrite }) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error("agent name must be lowercase kebab-case");

      let hostId: string | undefined;
      let dir: string;
      if (scope === "user") {
        hostId = undefined;
        dir = joinPath(wfHome, ".claude", "agents");
      } else {
        const src = await projectSource(projectId);
        hostId = src.hostId;
        dir = joinPath(src.path, ".claude", "agents");
      }

      const path = joinPath(dir, name + ".md");
      // FENCING: even though the kebab-case check above already rejects "/" and "..", normalize + confine
      // explicitly (matching the agentRefs style) so this guard doesn't silently rot if that check ever
      // loosens.
      if (!wfIsWithin(posixPath.normalize(path), posixPath.normalize(dir))) throw new Error("agent path escapes its scope directory");

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

  /**
   * Creates a new config file (skill or agent) from a raw name. `plan` takes
   * the area and the already-normalized slug and returns the path and
   * content. The write is create-only (expectedSha256 null): an existing
   * file isn't overwritten — we return `exists` instead, so the panel
   * doesn't clobber a same-named skill.
   */
  async function createFile(
    areaId: string,
    rawName: string,
    plan: (area: Area, slug: string) => { path: string; content: string },
  ): Promise<{
    outcome: "created" | "exists" | "invalid" | "not-found";
    path: string | null;
    message: string | null;
  }> {
    if (!isValidName(rawName)) {
      return {
        outcome: "invalid",
        path: null,
        message: "The name must contain Latin letters or digits.",
      };
    }
    const area = await resolveArea(bb, areaId);
    if (!area) {
      return { outcome: "not-found", path: null, message: "Area not found." };
    }

    const { path, content } = plan(area, slugifyName(rawName));
    const written = await bb.sdk.files.write({
      path,
      hostId: area.hostId,
      content,
      expectedSha256: null,
      createParents: true,
    });
    if (written.outcome === "conflict") {
      return { outcome: "exists", path, message: "One like this already exists." };
    }
    return { outcome: "created", path, message: null };
  }

  /**
   * Finds a skill: `base` — the folder of its SKILL.md (project overrides
   * personal), `root` — the `.claude` root, beyond which link-based reads
   * aren't allowed.
   */
  async function findSkill(
    area: Area,
    name: string,
  ): Promise<{ base: string; root: string } | null> {
    const dirs = [area.projectSkillsDir, area.personalSkillsDir].filter(
      (dir): dir is string => dir !== null,
    );
    for (const dir of dirs) {
      for (const rel of [`${name}/SKILL.md`, `synced/${name}/SKILL.md`]) {
        const { text } = await readFile(join(dir, rel), area.hostId, dir);
        if (text !== null) {
          return { base: dirname(join(dir, rel)), root: dirname(dir) };
        }
      }
    }
    return null;
  }

  /**
   * Sets a leveled field (plugin or skill) to the desired effective value,
   * writing the minimum. Globally there's one level: `default` removes the
   * key, otherwise we write it explicitly. In a project, if the broader
   * levels already give `target`, we drop the local override (a row "same as
   * global", which the UI dims); otherwise we set it explicitly.
   */
  async function writeLeveled<S extends string>(
    areaId: string,
    key: string,
    section: LeveledSection<S>,
    target: S,
  ): Promise<WriteOutcome> {
    const area = await resolveArea(bb, areaId);
    if (!area) return { outcome: "not-found", message: "Area not found." };

    // Both PluginToggle and SkillState include "inherit" — removing the key from the file.
    const inherit = "inherit" as S;

    if (area.kind === "global") {
      const own = target === section.default ? inherit : target;
      return applyEdit(areaId, (document) => section.set(document, key, own));
    }

    const broader: S[] = [];
    for (const path of area.levelPaths.slice(0, -1)) {
      const { text } = await readFile(path, area.hostId);
      try {
        broader.push(section.get(sd.parse(text), key));
      } catch (error) {
        if (error instanceof SettingsParseError) {
          return { outcome: "parse-error", message: error.message };
        }
        throw error;
      }
    }
    const own = section.resolve(broader) === target ? inherit : target;
    return applyEdit(areaId, (document) => section.set(document, key, own));
  }

  /**
   * MCP server toggle from .mcp.json. Stored as two arrays and accounts for
   * `enableAllProjectMcpServers`, so it doesn't fit the shared
   * `writeLeveled`: the default depends on enableAll, and `setMcpServer`
   * touches two keys. Same logic though — write the minimum: if the broader
   * levels already give target, drop the local override (server out of both
   * arrays), otherwise set it explicitly.
   */
  async function writeConnector(
    areaId: string,
    name: string,
    value: boolean,
  ): Promise<WriteOutcome> {
    const area = await resolveArea(bb, areaId);
    if (!area) return { outcome: "not-found", message: "Area not found." };
    const target = value ? "on" : "off";

    // Server states are taken from levels broader than the one being edited
    // (dropping the override makes its own value become inherit). enableAll,
    // though, is taken from ALL levels, including the one being edited:
    // setMcpServer doesn't touch it, and it keeps setting the default.
    const broaderStates: sd.McpServerState[] = [];
    const enableAllLevels: (boolean | undefined)[] = [];
    for (const [index, path] of area.levelPaths.entries()) {
      const { text } = await readFile(path, area.hostId);
      let parsed: sd.SettingsDoc;
      try {
        parsed = sd.parse(text);
      } catch (error) {
        if (error instanceof SettingsParseError) {
          return { outcome: "parse-error", message: error.message };
        }
        throw error;
      }
      if (index < area.levelPaths.length - 1) {
        broaderStates.push(sd.getMcpServer(parsed, name));
      }
      enableAllLevels.push(sd.getEnableAllMcp(parsed));
    }
    const own = decideMcpOwn(broaderStates, enableAllLevels, target);
    return applyEdit(areaId, (document) => sd.setMcpServer(document, name, own));
  }

  /**
   * Re-reads the edited file (a fresh sha), applies the pure edit, and
   * writes it with CAS protection. Reading fresh right before the write is
   * what makes the edit atomic against a concurrent Claude Code session: a
   * foreign write between our read and write won't match the sha and comes
   * back as a conflict rather than being clobbered.
   */
  async function applyEdit(
    areaId: string,
    edit: (doc: sd.SettingsDoc) => sd.SettingsDoc,
  ): Promise<{ outcome: "ok" | "conflict" | "parse-error" | "not-found"; message: string | null }> {
    const area = await resolveArea(bb, areaId);
    if (!area) return { outcome: "not-found", message: "Area not found." };

    const { text, sha256 } = await readFile(area.editedPath, area.hostId);
    let doc: sd.SettingsDoc;
    try {
      doc = sd.parse(text);
    } catch (error) {
      if (error instanceof SettingsParseError) {
        return { outcome: "parse-error", message: error.message };
      }
      throw error;
    }

    const next = sd.serialize(edit(doc));
    const written = await bb.sdk.files.write({
      path: area.editedPath,
      hostId: area.hostId,
      content: next,
      // If sha is present, write only on top of the same version; if the file is absent, it's create-only.
      expectedSha256: sha256 ?? null,
      createParents: true,
    });
    if (written.outcome === "conflict") {
      return {
        outcome: "conflict",
        message: "Another session changed the file. Refresh and try again.",
      };
    }
    return { outcome: "ok", message: null };
  }

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}

function emptyConfig(
  areaLabel: string,
  editedFilePath: string,
  error: { file: string; message: string } | null,
) {
  return {
    areaLabel,
    editedFilePath,
    error,
    plugins: [],
    connectors: [],
    skills: [],
    agents: [],
    hooks: [],
    toolSearch: { enabled: true as const, mode: "auto" as const, dimmed: false },
  };
}
