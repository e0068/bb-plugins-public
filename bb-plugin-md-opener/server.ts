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
} from "./packages/link-navigation/resolve";
// Direct import of the pure module (not the barrel index): otherwise the
// server would pull in the MdDocView React component and its CSS into the
// server bundle.
import {
  NATIVE_VIEWER_TOKEN_DEFAULTS,
  buildDescriptors,
} from "./packages/md-doc-view/kasimov-settings";
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
  // memory/decisions/kasimov-opener-css-uses-token-defaults.md), not
  // CUSTOM_TOKEN: without this change, Kasimov settings in MD Opener couldn't
  // override the hardcoded values.
  bb.settings.define(buildDescriptors(NATIVE_VIEWER_TOKEN_DEFAULTS));

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
}
