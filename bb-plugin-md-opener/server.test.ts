import { describe, expect, it, vi } from "vitest";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

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
};

interface FsFile {
  content: string;
  sha256: string;
}

// A virtual filesystem keyed by absolute paths + a bb mock that exposes the captured RPC handlers.
function setup(files: Record<string, FsFile>, env = { path: "/env", hostId: "h1" }) {
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
      files: {
        read: vi.fn(async (args: { path: string }) => {
          const f = files[args.path];
          if (!f) throw new Error("ENOENT");
          return { content: f.content, contentEncoding: "utf8", sha256: f.sha256 };
        }),
        write,
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
