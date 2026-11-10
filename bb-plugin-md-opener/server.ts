// bb-plugin-md-opener — the fileOpener slot's backend. Wiring layer: resolves
// the tab's source into a host+root (src/opener-source), reads the file
// confined to that root, along the way annotates body links as "live"
// (existing) and returns everything in a single response; writes edits with
// CAS. Link-parsing logic lives in pure layers (src/opener-links + the shared
// packages/link-navigation); this file is bb-I/O only.
import { homedir } from "node:os";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

import {
  parseHref,
  resolveRelative,
} from "@bb-plugins/link-navigation/resolve";
// Direct import of the pure module (not the barrel index): otherwise the
// server would pull in the MdDocView React component and its CSS into the
// server bundle.
import {
  NATIVE_VIEWER_TOKEN_DEFAULTS,
  buildDescriptors,
} from "@bb-plugins/md-doc-view/kasimov-settings";
import { renameProblem, siblingPath } from "@bb-plugins/md-doc-view/file-name";
import {
  revealInFinderHere,
} from "@bb-plugins/reveal-in-finder";
import { fileErrorKind } from "./src/file-errors";
import { extractLinkHrefs } from "./src/opener-links";
import { resolveSource, type OpenerSource } from "./src/opener-source";

// NOT strict: the host's source object may carry fields beyond the typed
// ones — strict would reject them, and the RPC would fail before reaching the
// handler ("Failed to load file"). We just drop the extras and read only the
// four fields we need.
const sourceSchema = z.object({
  kind: z.enum(["host", "thread-storage", "workspace"]),
  threadId: z.string().nullable(),
  environmentId: z.string().nullable(),
  projectId: z.string().nullable(),
});

// A body link: href as written in the markup, abs — the server's resolution
// (shared with the front end), exists — whether the target exists on the
// host. The front end takes abs from here instead of resolving `~` itself
// (see computeLinks).
const linkSchema = z.object({
  href: z.string(),
  abs: z.string(),
  exists: z.boolean(),
});

const docOutput = z.object({
  path: z.string(),
  content: z.string().nullable(),
  error: z.string().nullable(),
  sha256: z.string().nullable(),
  links: z.array(linkSchema),
});

export type DocContent = z.infer<typeof docOutput>;
export type DocLink = z.infer<typeof linkSchema>;

export const rpcContract = defineRpcContract({
  readDoc: {
    // path: relative (workspace/thread-storage) on first open, or absolute
    // when following a link. source is the tab's opaque token; the server
    // resolves the root/host.
    input: z.object({ path: z.string(), source: sourceSchema }).strict(),
    output: docOutput,
  },
  writeDoc: {
    // CAS write: expectedSha256 comes from readDoc. sha256 on success is the
    // new one.
    input: z
      .object({
        path: z.string(),
        source: sourceSchema,
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
  revealDoc: {
    // path: absolute (doc.path from a prior readDoc). Finder belongs to the
    // machine running bb's server — a source on a remote host is refused.
    input: z.object({ path: z.string(), source: sourceSchema }).strict(),
    output: z.object({
      revealed: z.boolean(),
      error: z.string().nullable(),
    }),
  },
  renameDoc: {
    // path: absolute (doc.path from a prior readDoc); name: the new name in
    // the same folder. path on success is the file's new absolute path.
    input: z.object({ path: z.string(), source: sourceSchema, name: z.string() }).strict(),
    output: z.object({
      outcome: z.enum(["renamed", "exists", "invalid", "denied", "not-found"]),
      path: z.string().nullable(),
      message: z.string().nullable(),
    }),
  },
  deleteDoc: {
    // path: absolute (doc.path from a prior readDoc). A file only — never a
    // directory, never recursively.
    input: z.object({ path: z.string(), source: sourceSchema }).strict(),
    output: z.object({
      outcome: z.enum(["removed", "denied", "not-found"]),
      message: z.string().nullable(),
    }),
  },
  // Read by the composer format-bar content script via plain fetch, not
  // useSettings: SDK data hooks throw inside a content script's headless
  // root (no QueryClientProvider —
  // docs/decisions/row-status-rpc-not-frontend-hooks.md, the same finding
  // for a different content script in this repo).
  composerBarEnabled: {
    input: z.object({}).strict().default({}),
    output: z.object({ enabled: z.boolean() }),
  },
});

// --- pure path helpers (server-side, node-free except homedir) --------------

function joinPath(dir: string, rel: string): string {
  return dir.endsWith("/") ? `${dir}${rel}` : `${dir}/${rel}`;
}

function dirOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx <= 0 ? "/" : path.slice(0, idx);
}

function baseOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

function isWithin(root: string, target: string): boolean {
  if (target === root) return true;
  return target.startsWith(root.endsWith("/") ? root : `${root}/`);
}

/** Expands a leading `~` to the server host's home directory (for `~/…` links). */
function expandTilde(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return joinPath(homedir(), path.slice(2));
  return path;
}

/**
 * The document's absolute path from the input `path`: for host it's already
 * absolute (after `~` expansion); otherwise a relative path is joined to the
 * root (an absolute path arriving via a link jump is left as is — the caller
 * checks the fence).
 */
function toAbsolute(
  source: OpenerSource,
  root: string | undefined,
  path: string,
): string {
  const expanded = expandTilde(path);
  if (source.kind === "host") return expanded;
  if (expanded.startsWith("/")) return expanded;
  return root ? joinPath(root, expanded) : expanded;
}

export default function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  // This plugin's own (separate) Kasimov settings: sizes/spacing/colors/fonts
  // + flags. The schema is shared with Cloud Config
  // (packages/md-doc-view/kasimov-settings), but this plugin's values are
  // independent. The front end reads them via useSettings.
  //
  // Default presets are "to match the native bb viewer" (previously hardcoded
  // in packages/md-doc-view/md-doc-view.css, see
  // docs/decisions/kasimov-opener-css-uses-token-defaults.md), not
  // CUSTOM_TOKEN: without this change, Kasimov settings in MD Opener couldn't
  // override the hardcoded values.
  //
  // kasimovComposerBar is this plugin's own flag, not part of the shared
  // kasimov-settings schema: Cloud Config doesn't register the composer
  // content script, so the shared table (which only feeds MdDocView's
  // engine flags/CSS vars) has no use for it — see
  // docs/decisions/kasimov-composer-bar-flag.md.
  const settingsHandle = bb.settings.define({
    ...buildDescriptors(NATIVE_VIEWER_TOKEN_DEFAULTS),
    kasimovComposerBar: {
      type: "boolean" as const,
      label: "Kasimov: use in Composer",
      description:
        "Show Kasimov's floating format bar over the thread composer when text is selected",
      default: false,
    },
  });

  // File read: absence is an empty result (text=null), not an exception.
  async function readFile(
    path: string,
    hostId: string | undefined,
    rootPath: string | undefined,
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

  /**
   * Annotates body links as live. Each link's abs is resolved with the same
   * resolveRelative as the front end (after `~` expansion) — so both sides
   * agree. Existence is determined by listing directories (one listPaths per
   * directory, not by reading files); for non-host, directories outside the
   * root aren't listed.
   */
  async function computeLinks(
    body: string,
    docAbs: string,
    hostId: string | undefined,
    root: string | undefined,
  ): Promise<DocLink[]> {
    const entries = extractLinkHrefs(body).map((href) => {
      const raw = expandTilde(parseHref(href).path);
      return { href, abs: resolveRelative(docAbs, raw) };
    });
    if (entries.length === 0) return [];

    const namesByDir = new Map<string, Set<string> | null>();
    const dirs = new Set(entries.map((e) => dirOf(e.abs)));
    for (const dir of dirs) {
      if (root && !isWithin(root, dir)) {
        namesByDir.set(dir, null); // outside the root — don't list, treat as dead
        continue;
      }
      try {
        const listing = await bb.sdk.files.listPaths({
          path: dir,
          hostId,
          includeFiles: true,
          includeDirectories: true,
          limit: 5000,
        });
        namesByDir.set(dir, new Set(listing.paths.map((p) => p.name)));
      } catch {
        namesByDir.set(dir, null);
      }
    }

    return entries.map(({ href, abs }) => ({
      href,
      abs,
      exists: namesByDir.get(dirOf(abs))?.has(baseOf(abs)) ?? false,
    }));
  }

  bb.rpc.register(rpcContract, {
    async readDoc({ path, source }) {
      try {
        return await doRead(path, source);
      } catch (err) {
        bb.log.error(`readDoc failed: ${String(err)}`);
        return {
          path,
          content: null,
          error: `Failed to read: ${String(err)}`,
          sha256: null,
          links: [],
        };
      }
    },

    async writeDoc(input) {
      try {
        return await doWrite(input);
      } catch (err) {
        bb.log.error(`writeDoc failed: ${String(err)}`);
        return {
          outcome: "denied" as const,
          sha256: null,
          message: `Failed to save: ${String(err)}`,
        };
      }
    },

    async revealDoc({ path, source }) {
      try {
        return await doReveal(path, source);
      } catch (err) {
        bb.log.error(`revealDoc failed: ${String(err)}`);
        return { revealed: false, error: `Failed to reveal: ${String(err)}` };
      }
    },

    async renameDoc({ path, source, name }) {
      try {
        return await doRename(path, source, name);
      } catch (err) {
        bb.log.error(`renameDoc failed: ${String(err)}`);
        return { outcome: "denied" as const, path: null, message: `Failed to rename: ${String(err)}` };
      }
    },

    async deleteDoc({ path, source }) {
      try {
        return await doDelete(path, source);
      } catch (err) {
        bb.log.error(`deleteDoc failed: ${String(err)}`);
        return { outcome: "denied" as const, message: `Failed to delete: ${String(err)}` };
      }
    },

    async composerBarEnabled() {
      const values = await settingsHandle.get();
      return { enabled: values.kasimovComposerBar === true };
    },
  });

  async function doRead(path: string, source: OpenerSource): Promise<DocContent> {
    const resolved = await resolveSource(bb, source);
    if (!resolved) {
      return {
        path: "",
        content: null,
        error: "Tab source unavailable.",
        sha256: null,
        links: [],
      };
    }
    const abs = toAbsolute(source, resolved.root, path);
    if (resolved.root && !isWithin(resolved.root, abs)) {
      return {
        path: abs,
        content: null,
        error: "Path is outside the source root.",
        sha256: null,
        links: [],
      };
    }
    const { text, sha256 } = await readFile(abs, resolved.hostId, resolved.root);
    if (text === null) {
      return {
        path: abs,
        content: null,
        error: "File not found.",
        sha256: null,
        links: [],
      };
    }
    const links = await computeLinks(text, abs, resolved.hostId, resolved.root);
    return { path: abs, content: text, error: null, sha256, links };
  }

  async function doWrite(input: {
    path: string;
    source: OpenerSource;
    content: string;
    expectedSha256: string | null;
  }): Promise<{
    outcome: "written" | "conflict" | "denied" | "not-found";
    sha256: string | null;
    message: string | null;
  }> {
    const { path, source, content, expectedSha256 } = input;
    const resolved = await resolveSource(bb, source);
    if (!resolved) {
      return {
        outcome: "not-found",
        sha256: null,
        message: "Tab source unavailable.",
      };
    }
    const abs = toAbsolute(source, resolved.root, path);
    if (resolved.root && !isWithin(resolved.root, abs)) {
      return {
        outcome: "denied",
        sha256: null,
        message: "Path is outside the source root.",
      };
    }
    const written = await bb.sdk.files.write({
      path: abs,
      hostId: resolved.hostId,
      rootPath: resolved.root,
      content,
      expectedSha256,
    });
    if (written.outcome === "conflict") {
      return {
        outcome: "conflict",
        sha256: written.currentSha256,
        message: "The file changed on disk. Refresh and try again.",
      };
    }
    return { outcome: "written", sha256: written.sha256, message: null };
  }

  type Located =
    | { ok: true; abs: string; hostId: string | undefined; root: string | undefined }
    | { ok: false; outcome: "denied" | "not-found"; message: string };

  // The file an action is aimed at: the tab's source resolved and the path
  // made absolute and held inside the root. Whether the file is there is the
  // host's to say — move and remove refuse on their own, and listPaths walks
  // the whole tree below a folder, so asking it first would be slow and wrong.
  async function locate(path: string, source: OpenerSource): Promise<Located> {
    const resolved = await resolveSource(bb, source);
    if (!resolved) return { ok: false, outcome: "not-found", message: "Tab source unavailable." };
    const abs = toAbsolute(source, resolved.root, path);
    if (resolved.root && !isWithin(resolved.root, abs)) {
      return { ok: false, outcome: "denied", message: "Path is outside the source root." };
    }
    return { ok: true, abs, hostId: resolved.hostId, root: resolved.root };
  }

  const NOT_FOUND = "File not found.";

  async function doRename(
    path: string,
    source: OpenerSource,
    name: string,
  ): Promise<{
    outcome: "renamed" | "exists" | "invalid" | "denied" | "not-found";
    path: string | null;
    message: string | null;
  }> {
    // The name first: a name with a slash is refused before any path is built
    // from it, so it can never lead the file out of its folder.
    const problem = renameProblem(name, path);
    if (problem !== null) return { outcome: "invalid", path: null, message: problem };
    const file = await locate(path, source);
    if (!file.ok) return { outcome: file.outcome, path: null, message: file.message };
    const target = siblingPath(file.abs, name);
    try {
      await bb.sdk.files.move({
        sourcePath: file.abs,
        destinationPath: target,
        hostId: file.hostId,
        rootPath: file.root,
      });
    } catch (err) {
      const kind = fileErrorKind(err);
      if (kind === "exists") {
        return { outcome: "exists", path: null, message: "A file with that name already exists." };
      }
      if (kind === "not-found") return { outcome: "not-found", path: null, message: NOT_FOUND };
      throw err;
    }
    return { outcome: "renamed", path: target, message: null };
  }

  async function doDelete(
    path: string,
    source: OpenerSource,
  ): Promise<{ outcome: "removed" | "denied" | "not-found"; message: string | null }> {
    const file = await locate(path, source);
    if (!file.ok) return { outcome: file.outcome, message: file.message };
    try {
      await bb.sdk.files.remove({ path: file.abs, hostId: file.hostId, rootPath: file.root });
    } catch (err) {
      if (fileErrorKind(err) === "not-found") return { outcome: "not-found", message: NOT_FOUND };
      throw err;
    }
    return { outcome: "removed", message: null };
  }

  async function doReveal(
    path: string,
    source: OpenerSource,
  ): Promise<{ revealed: boolean; error: string | null }> {
    const resolved = await resolveSource(bb, source);
    if (!resolved) return { revealed: false, error: "Tab source unavailable." };
    const abs = toAbsolute(source, resolved.root, path);
    if (resolved.root && !isWithin(resolved.root, abs)) {
      return { revealed: false, error: "Path is outside the source root." };
    }
    // Finder belongs to the machine running bb's server: only reveal a
    // source whose host is that primary/local host, never a remote one.
    // resolved.hostId is undefined when the source carries no environment at
    // all (e.g. a bare "host" tab) — that case has no host to compare and is
    // treated as local, matching resolveSource's own contract. Same check as
    // revealTaskSource in bb-plugin-tasks-plus/api/index.ts.
    const { primaryHostId } = await bb.sdk.system.config();
    if (
      primaryHostId === null ||
      (resolved.hostId !== undefined && resolved.hostId !== primaryHostId)
    ) {
      return {
        revealed: false,
        error: "Only a local source can be revealed in Finder",
      };
    }
    return await revealInFinderHere(abs);
  }
}
