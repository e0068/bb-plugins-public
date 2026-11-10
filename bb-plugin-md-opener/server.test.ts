import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import {
  resetRevealExecFileProvider,
  revealExecFileProvider,
} from "@bb-plugins/reveal-in-finder";
import plugin, { type rpcContract } from "./server";

type Handlers = {
  readDoc: (input: {
    path: string;
    source: unknown;
  }) => Promise<{ path: string; content: string | null; error: string | null; sha256: string | null; links: { href: string; abs: string; exists: boolean }[] }>;
  writeDoc: (input: {
    path: string;
    source: unknown;
    content: string;
    expectedSha256: string | null;
  }) => Promise<{ outcome: string; sha256: string | null; message: string | null }>;
  revealDoc: (input: {
    path: string;
    source: unknown;
  }) => Promise<{ revealed: boolean; error: string | null }>;
  renameDoc: (input: {
    path: string;
    source: unknown;
    name: string;
  }) => Promise<{ outcome: string; path: string | null; message: string | null }>;
  deleteDoc: (input: {
    path: string;
    source: unknown;
  }) => Promise<{ outcome: string; message: string | null }>;
};

interface FsFile {
  content: string;
  sha256: string;
}

// A virtual filesystem keyed by absolute paths + a bb mock that exposes the captured RPC handlers.
function setup(
  files: Record<string, FsFile>,
  env = { path: "/env", hostId: "h1" },
  primaryHostId: string | null = "h1",
) {
  let handlers!: Handlers;
  const write = vi.fn(
    async (args: { path: string; content: string; expectedSha256: string | null }) => {
      const cur = files[args.path];
      const curSha = cur?.sha256 ?? null;
      if (args.expectedSha256 !== undefined && args.expectedSha256 !== curSha) {
        return { outcome: "conflict" as const, currentSha256: curSha };
      }
      files[args.path] = { content: args.content, sha256: `sha:${args.content.length}` };
      return { outcome: "written" as const, sha256: files[args.path].sha256 };
    },
  );
  const bb = {
    log: { info: vi.fn(), error: vi.fn() },
    settings: { define: vi.fn(() => ({ get: vi.fn(), onChange: vi.fn() })) },
    rpc: {
      register: (_contract: typeof rpcContract, h: Handlers) => {
        handlers = h;
      },
    },
    sdk: {
      environments: { get: vi.fn(async () => env) },
      threads: { storageFiles: vi.fn(async () => ({ storageRootPath: "/store" })) },
      system: { config: vi.fn(async () => ({ primaryHostId })) },
      files: {
        read: vi.fn(async (args: { path: string }) => {
          const f = files[args.path];
          if (!f) throw new Error("ENOENT");
          return { content: f.content, contentEncoding: "utf8", sha256: f.sha256 };
        }),
        write,
        // As the host does: move never overwrites, and both refuse a source
        // that is not there (host-daemon move_path / remove_path).
        move: vi.fn(async (args: { sourcePath: string; destinationPath: string }) => {
          if (!files[args.sourcePath]) {
            throw Object.assign(new Error(`ENOENT: no such file or directory, lstat '${args.sourcePath}'`), { code: "ENOENT" });
          }
          if (files[args.destinationPath]) {
            throw new Error(`Destination already exists: ${args.destinationPath}`);
          }
          files[args.destinationPath] = files[args.sourcePath];
          delete files[args.sourcePath];
          return { ok: true };
        }),
        remove: vi.fn(async (args: { path: string }) => {
          if (!files[args.path]) {
            throw Object.assign(new Error(`ENOENT: no such file or directory, lstat '${args.path}'`), { code: "ENOENT" });
          }
          delete files[args.path];
          return { ok: true };
        }),
        listPaths: vi.fn(async (args: { path: string }) => {
          const prefix = args.path.endsWith("/") ? args.path : `${args.path}/`;
          const names = new Set<string>();
          for (const abs of Object.keys(files)) {
            if (abs.startsWith(prefix)) {
              const rest = abs.slice(prefix.length);
              if (!rest.includes("/")) names.add(rest);
            }
          }
          return {
            paths: [...names].map((name) => ({ name, path: `${prefix}${name}`, kind: "file" })),
            truncated: false,
          };
        }),
      },
    },
  } as unknown as BbPluginApi;

  plugin(bb);
  return { handlers, bb, write };
}

const workspace = {
  kind: "workspace" as const,
  threadId: null,
  environmentId: "e1",
  projectId: null,
};

describe("readDoc", () => {
  it("reads a file under the root and annotates live/dead links in one response", async () => {
    const { handlers } = setup({
      "/env/notes/doc.md": {
        content: "see [neighbor](sub.md) and [missing](missing.md)",
        sha256: "sha-doc",
      },
      "/env/notes/sub.md": { content: "# sub", sha256: "sha-sub" },
    });

    const res = await handlers.readDoc({ path: "notes/doc.md", source: workspace });

    expect(res.error).toBeNull();
    expect(res.path).toBe("/env/notes/doc.md");
    expect(res.sha256).toBe("sha-doc");
    expect(res.links).toEqual([
      { href: "sub.md", abs: "/env/notes/sub.md", exists: true },
      { href: "missing.md", abs: "/env/notes/missing.md", exists: false },
    ]);
  });

  it("jumping to an absolute link outside the root is blocked by the fence", async () => {
    const { handlers } = setup({ "/env/a.md": { content: "x", sha256: "s" } });
    const res = await handlers.readDoc({ path: "/etc/passwd", source: workspace });
    expect(res.content).toBeNull();
    expect(res.error).toBe("Path is outside the source root.");
  });

  it("a nonexistent file is an error, not an exception", async () => {
    const { handlers } = setup({});
    const res = await handlers.readDoc({ path: "nope.md", source: workspace });
    expect(res.content).toBeNull();
    expect(res.error).toBe("File not found.");
  });

  it("a host path is read as absolute, with no root fence", async () => {
    const { handlers } = setup({ "/abs/anywhere/n.md": { content: "hi", sha256: "s" } });
    const res = await handlers.readDoc({
      path: "/abs/anywhere/n.md",
      source: { kind: "host", threadId: null, environmentId: null, projectId: null },
    });
    expect(res.error).toBeNull();
    expect(res.content).toBe("hi");
  });
});

describe("writeDoc", () => {
  it("a CAS success returns the NEW sha256 (not the old one)", async () => {
    const { handlers } = setup({
      "/env/doc.md": { content: "old", sha256: "sha-old" },
    });
    const res = await handlers.writeDoc({
      path: "/env/doc.md",
      source: workspace,
      content: "updated!",
      expectedSha256: "sha-old",
    });
    expect(res.outcome).toBe("written");
    expect(res.sha256).toBe("sha:8");
    expect(res.sha256).not.toBe("sha-old");
  });

  it("a CAS conflict doesn't write and returns the current sha", async () => {
    const files = { "/env/doc.md": { content: "disk", sha256: "sha-disk" } };
    const { handlers } = setup(files);
    const res = await handlers.writeDoc({
      path: "/env/doc.md",
      source: workspace,
      content: "mine",
      expectedSha256: "sha-stale",
    });
    expect(res.outcome).toBe("conflict");
    expect(res.sha256).toBe("sha-disk");
    expect(files["/env/doc.md"].content).toBe("disk");
  });

  it("a write outside the root is denied", async () => {
    const { handlers } = setup({});
    const res = await handlers.writeDoc({
      path: "/etc/evil",
      source: workspace,
      content: "x",
      expectedSha256: null,
    });
    expect(res.outcome).toBe("denied");
  });
});

// revealDoc shells out to `open -R` (node:child_process.execFile). These
// tests swap in a fake execFile via the shared package's provider seam (see
// packages/reveal-in-finder/index.ts) so the handler wiring is exercised
// without ever spawning a real Finder process.
describe("revealDoc", () => {
  const revealCalls: { file: string; args: readonly string[] }[] = [];

  beforeEach(() => {
    revealCalls.length = 0;
    revealExecFileProvider.current = (file, args, callback) => {
      revealCalls.push({ file, args });
      callback(null);
    };
  });

  afterEach(() => {
    resetRevealExecFileProvider();
  });

  it("reveals a file whose environment's host matches the server's primary host", async () => {
    // The realistic shape: environments.get().hostId is a required string in
    // the SDK, never undefined, for a workspace tab. "Local" means it equals
    // the server's own primaryHostId, not that hostId is absent.
    const { handlers } = setup(
      { "/env/doc.md": { content: "x", sha256: "s" } },
      { path: "/env", hostId: "h1" },
      "h1",
    );
    const res = await handlers.revealDoc({ path: "/env/doc.md", source: workspace });
    expect(res).toEqual({ revealed: true, error: null });
    expect(revealCalls).toEqual([{ file: "open", args: ["-R", "/env/doc.md"] }]);
  });

  it("a source with no environment at all (undefined hostId) is treated as local", async () => {
    const { handlers } = setup(
      { "/abs/doc.md": { content: "x", sha256: "s" } },
      { path: "/env", hostId: "h1" },
      "h1",
    );
    const res = await handlers.revealDoc({
      path: "/abs/doc.md",
      source: { kind: "host", threadId: null, environmentId: null, projectId: null },
    });
    expect(res).toEqual({ revealed: true, error: null });
  });

  it("refuses a source whose environment host differs from the server's primary host", async () => {
    const { handlers } = setup(
      { "/env/doc.md": { content: "x", sha256: "s" } },
      { path: "/env", hostId: "h2" },
      "h1",
    );
    const res = await handlers.revealDoc({ path: "/env/doc.md", source: workspace });
    expect(res.revealed).toBe(false);
    expect(res.error).toMatch(/local/);
    expect(revealCalls).toEqual([]);
  });

  it("refuses when the server has no primary host, without shelling out", async () => {
    const { handlers } = setup(
      { "/env/doc.md": { content: "x", sha256: "s" } },
      { path: "/env", hostId: "h1" },
      null,
    );
    const res = await handlers.revealDoc({ path: "/env/doc.md", source: workspace });
    expect(res.revealed).toBe(false);
    expect(res.error).toMatch(/local/);
    expect(revealCalls).toEqual([]);
  });

  it("refuses a path outside the source root, without shelling out", async () => {
    const { handlers } = setup({}, { path: "/env", hostId: "h1" }, "h1");
    const res = await handlers.revealDoc({ path: "/etc/passwd", source: workspace });
    expect(res.revealed).toBe(false);
    expect(res.error).toBe("Path is outside the source root.");
    expect(revealCalls).toEqual([]);
  });
});

describe("renameDoc", () => {
  it("renames a file under the root in its own folder and returns the new path", async () => {
    const files = { "/env/notes/a.md": { content: "x", sha256: "s" } };
    const { handlers, bb } = setup(files);
    const res = await handlers.renameDoc({ path: "/env/notes/a.md", source: workspace, name: "b.md" });
    expect(res).toEqual({ outcome: "renamed", path: "/env/notes/b.md", message: null });
    expect(bb.sdk.files.move).toHaveBeenCalledWith(
      expect.objectContaining({
        sourcePath: "/env/notes/a.md",
        destinationPath: "/env/notes/b.md",
        hostId: "h1",
      }),
    );
    expect(Object.keys(files)).toEqual(["/env/notes/b.md"]);
  });

  it("a name with a slash is refused before the disk is touched", async () => {
    const { handlers, bb } = setup({ "/env/a.md": { content: "a", sha256: "sa" } });
    const res = await handlers.renameDoc({ path: "/env/a.md", source: workspace, name: "../b.md" });
    expect(res.outcome).toBe("invalid");
    expect(bb.sdk.files.move).not.toHaveBeenCalled();
  });

  it("a file outside the root is refused", async () => {
    const { handlers, bb } = setup({ "/other/a.md": { content: "a", sha256: "sa" } });
    const res = await handlers.renameDoc({ path: "/other/a.md", source: workspace, name: "b.md" });
    expect(res.outcome).toBe("denied");
    expect(bb.sdk.files.move).not.toHaveBeenCalled();
  });

});

describe("deleteDoc", () => {
  it("removes a file under the root once", async () => {
    const files = { "/env/a.md": { content: "a", sha256: "sa" } };
    const { handlers, bb } = setup(files);
    const res = await handlers.deleteDoc({ path: "/env/a.md", source: workspace });
    expect(res).toEqual({ outcome: "removed", message: null });
    expect(bb.sdk.files.remove).toHaveBeenCalledTimes(1);
    expect(bb.sdk.files.remove).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/env/a.md", hostId: "h1" }),
    );
    expect(files).toEqual({});
  });

  it("a file outside the root is refused", async () => {
    const { handlers, bb } = setup({ "/other/a.md": { content: "a", sha256: "sa" } });
    const res = await handlers.deleteDoc({ path: "/other/a.md", source: workspace });
    expect(res.outcome).toBe("denied");
    expect(bb.sdk.files.remove).not.toHaveBeenCalled();
  });

  it("a failure on the host becomes a refusal with its message", async () => {
    const { handlers, bb } = setup({ "/env/a.md": { content: "a", sha256: "sa" } });
    vi.mocked(bb.sdk.files.remove).mockRejectedValueOnce(new Error("EACCES"));
    const res = await handlers.deleteDoc({ path: "/env/a.md", source: workspace });
    expect(res.outcome).toBe("denied");
    expect(res.message).toContain("EACCES");
  });
});

describe("renameDoc and deleteDoc — what the host refuses", () => {
  it("a name another file already has comes back as exists, and both files stay", async () => {
    const files = {
      "/env/a.md": { content: "a", sha256: "sa" },
      "/env/b.md": { content: "b", sha256: "sb" },
    };
    const { handlers } = setup(files);
    const res = await handlers.renameDoc({ path: "/env/a.md", source: workspace, name: "b.md" });
    expect(res).toEqual({
      outcome: "exists",
      path: null,
      message: "A file with that name already exists.",
    });
    expect(files["/env/a.md"].content).toBe("a");
    expect(files["/env/b.md"].content).toBe("b");
  });

  it("a name taken only somewhere deeper in the tree is free to use", async () => {
    const files = {
      "/env/a.md": { content: "a", sha256: "sa" },
      "/env/sub/README.md": { content: "r", sha256: "sr" },
    };
    const { handlers } = setup(files);
    const res = await handlers.renameDoc({ path: "/env/a.md", source: workspace, name: "README.md" });
    expect(res.outcome).toBe("renamed");
    expect(res.path).toBe("/env/README.md");
  });

  it("renaming a file that is not there comes back as not-found", async () => {
    const { handlers } = setup({});
    const res = await handlers.renameDoc({ path: "/env/a.md", source: workspace, name: "b.md" });
    expect(res.outcome).toBe("not-found");
  });

  it("deleting a file that is not there comes back as not-found", async () => {
    const { handlers } = setup({});
    const res = await handlers.deleteDoc({ path: "/env/a.md", source: workspace });
    expect(res.outcome).toBe("not-found");
  });

  it("the file lookup never walks the folder tree", async () => {
    const { handlers, bb } = setup({ "/env/a.md": { content: "a", sha256: "sa" } });
    await handlers.renameDoc({ path: "/env/a.md", source: workspace, name: "b.md" });
    await handlers.deleteDoc({ path: "/env/b.md", source: workspace });
    expect(bb.sdk.files.listPaths).not.toHaveBeenCalled();
  });
});
